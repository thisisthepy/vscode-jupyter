// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernel, KernelConnectionMetadata } from '../../kernels/types';
import { execCodeInBackgroundThread } from '../api/kernels/backgroundExecution';
import { getEnvExtApi } from '../../platform/api/python-envs/pythonEnvsApi';
import { raceTimeout } from '../../platform/common/utils/async';
import { IControllerRegistration, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { raceCancellation } from '../../platform/common/cancellation';
import { DisposableStore } from '../../platform/common/utils/lifecycle';
import { getNotebookMetadata } from '../../platform/common/utils';
import { JVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { getNameOfKernelConnection, isPythonNotebook } from '../../kernels/helpers';
import { logger } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { getPythonPackagesInKernel } from './listPackageTool.node';

export async function sendPipListRequest(kernel: IKernel, token: vscode.CancellationToken) {
    const codeToExecute = `import subprocess
proc = subprocess.Popen(["pip", "list", "--format", "json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
stdout, stderr = proc.communicate()
return stdout
`.split('\n');

    try {
        const packages = await execCodeInBackgroundThread<packageDefinition[]>(kernel, codeToExecute, token);
        return packages;
    } catch (ex) {
        throw ex;
    }
}

export async function sendPipInstallRequest(kernel: IKernel, packages: string[], token: vscode.CancellationToken) {
    const packageList = packages.join('", "');
    const codeToExecute = `import subprocess
proc = subprocess.Popen(["pip", "install", "${packageList}"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
stdout, stderr = proc.communicate()
return {"result": stdout}
`.split('\n');

    try {
        const result = await execCodeInBackgroundThread<{ result: string }>(kernel, codeToExecute, token);
        return result?.result;
    } catch (ex) {
        throw ex;
    }
}

export async function getPackagesFromEnvsExtension(kernelUri: vscode.Uri): Promise<packageDefinition[] | undefined> {
    const envsApi = await getEnvExtApi();
    if (!envsApi) {
        return;
    }

    const environment = await envsApi.resolveEnvironment(kernelUri);
    if (!environment) {
        return;
    }

    return await envsApi.getPackages(environment);
}

export async function installPackageThroughEnvsExtension(kernelUri: vscode.Uri, packages: string[]): Promise<boolean> {
    const envsApi = await getEnvExtApi();
    if (!envsApi) {
        return false;
    }

    const environment = await envsApi.resolveEnvironment(kernelUri);
    if (!environment) {
        return false;
    }

    await envsApi.managePackages(environment, { install: packages });
    return true;
}

export type packageDefinition = { name: string; version?: string };

export async function ensureKernelSelectedAndStarted(
    notebook: vscode.NotebookDocument,
    controllerRegistration: IControllerRegistration,
    token: vscode.CancellationToken
) {
    if (!controllerRegistration.getSelected(notebook)) {
        logger.trace(`No kernel selected, displaying quick pick for notebook ${getDisplayPath(notebook.uri)}`);
        const disposables = new DisposableStore();
        try {
            const selectedPromise = new Promise<void>((resolve) =>
                disposables.add(
                    controllerRegistration.onControllerSelected((e) => {
                        logger.trace(`Kernel selected for notebook ${getDisplayPath(notebook.uri)}`);
                        if (e.notebook === notebook) {
                            resolve();
                        }
                    })
                )
            );

            if (!vscode.window.visibleNotebookEditors.some((e) => e.notebook === notebook)) {
                await vscode.window.showNotebookDocument(notebook);
            }

            const result = await raceCancellation(
                token,
                vscode.commands.executeCommand('notebook.selectKernel', {
                    notebookUri: notebook.uri,
                    skipIfAlreadySelected: true
                })
            );

            logger.trace(`Kernel Selector invoked for notebook ${getDisplayPath(notebook.uri)} and returned ${result}`);
            await raceTimeout(500, raceCancellation(token, selectedPromise));
        } finally {
            disposables.dispose();
        }
    }

    const controller = controllerRegistration.getSelected(notebook);
    if (controller) {
        logger.trace(`Kernel selected for notebook ${getDisplayPath(notebook.uri)}`);
        return raceCancellation(token, controller.startKernel(notebook));
    } else {
        logger.warn(`No kernel controller selected for notebook ${getDisplayPath(notebook.uri)}`);
    }
}

export async function selectKernelAndStart(
    notebook: vscode.NotebookDocument,
    connection: KernelConnectionMetadata,
    controllerRegistration: IControllerRegistration,
    token: vscode.CancellationToken,
    startKernel: boolean = true
) {
    if (!controllerRegistration.getSelected(notebook)) {
        const disposables = new DisposableStore();
        try {
            const selectedPromise = new Promise<void>((resolve) =>
                disposables.add(
                    controllerRegistration.onControllerSelected((e) =>
                        e.notebook === notebook ? resolve() : undefined
                    )
                )
            );

            const editor =
                vscode.window.visibleNotebookEditors.find((e) => e.notebook === notebook) ||
                (await vscode.window.showNotebookDocument(notebook));

            await raceCancellation(
                token,
                vscode.commands.executeCommand('notebook.selectKernel', {
                    editor,
                    id: connection.id,
                    extension: JVSC_EXTENSION_ID
                })
            );

            await raceTimeout(500, raceCancellation(token, selectedPromise));
        } finally {
            disposables.dispose();
        }
    }

    const controller = controllerRegistration.getSelected(notebook);
    if (controller && startKernel) {
        return raceCancellation(token, controller.startKernel(notebook));
    }
}

export async function getToolResponseForConfiguredNotebook(
    selectedController: IVSCodeNotebookController,
    kernel: IKernel | undefined
): Promise<vscode.LanguageModelToolResult> {
    const messages = [
        `Notebook has been configured to use the kernel ${
            selectedController.label || getNameOfKernelConnection(selectedController.connection)
        }, and the Kernel has been successfully started.`
    ];

    // We don't want to delay configuring notebook controller just because fetchign packages is slow.
    const packagesMessage = kernel ? await raceTimeout(5_000, getPythonPackagesInKernel(kernel)) : undefined;

    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(messages.join(' ')),
        ...(packagesMessage ? [packagesMessage] : [])
    ]);
}

export function getPrimaryLanguageOfNotebook(notebook: vscode.NotebookDocument) {
    if (notebook.getCells().some((c) => c.document.languageId === PYTHON_LANGUAGE)) {
        return PYTHON_LANGUAGE;
    }
    if (isPythonNotebook(getNotebookMetadata(notebook))) {
        return PYTHON_LANGUAGE;
    }
    return (
        notebook.getCells().find((c) => c.kind === vscode.NotebookCellKind.Code)?.document.languageId || PYTHON_LANGUAGE
    );
}

export function hasKernelStartedOrIsStarting(kernel: IKernel) {
    if (kernel.status === 'dead' || kernel.status === 'terminating' || kernel.status === 'unknown') {
        return false;
    }
    return true;
}
