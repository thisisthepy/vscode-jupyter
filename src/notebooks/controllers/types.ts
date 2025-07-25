// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as vscode from 'vscode';
import {
    IKernel,
    KernelConnectionMetadata,
    LocalKernelConnectionMetadata,
    PythonKernelConnectionMetadata,
    RemoteKernelConnectionMetadata
} from '../../kernels/types';
import { JupyterNotebookView, InteractiveWindowView } from '../../platform/common/constants';
import { IDisposable } from '../../platform/common/types';
import { JupyterServerCollection } from '../../api';
import { EnvironmentPath } from '@vscode/python-extension';
import type { VSCodeNotebookController } from './vscodeNotebookController';

export const InteractiveControllerIdSuffix = ' (Interactive)';

export interface IVSCodeNotebookController extends IDisposable {
    readonly connection: KernelConnectionMetadata;
    readonly controller: vscode.NotebookController;
    readonly id: string;
    readonly label: string;
    readonly viewType: typeof JupyterNotebookView | typeof InteractiveWindowView;
    readonly onNotebookControllerSelectionChanged: vscode.Event<{
        selected: boolean;
        notebook: vscode.NotebookDocument;
        controller: VSCodeNotebookController;
    }>;
    readonly onConnecting: vscode.Event<void>;
    readonly onDidDispose: vscode.Event<void>;
    readonly onDidReceiveMessage: vscode.Event<{ editor: vscode.NotebookEditor; message: any }>;
    startKernel(notebook: vscode.NotebookDocument): Promise<IKernel>;
    restoreConnection(notebook: vscode.NotebookDocument): Promise<void>;
    postMessage(message: any, editor?: vscode.NotebookEditor): Thenable<boolean>;
    asWebviewUri(localResource: vscode.Uri): vscode.Uri;
    isAssociatedWithDocument(notebook: vscode.NotebookDocument): boolean;
    updateConnection(connection: KernelConnectionMetadata): void;
    setPendingCellAddition(notebook: vscode.NotebookDocument, promise: Promise<void>): void;
}

export interface IVSCodeNotebookControllerUpdateEvent {
    added: IVSCodeNotebookController[];
    removed: IVSCodeNotebookController[];
}

export const IControllerRegistration = Symbol('IControllerRegistration');

export interface IControllerRegistration {
    /**
     * Gets the registered list of all of the controllers (the ones shown by VS code)
     */
    registered: IVSCodeNotebookController[];
    /**
     * Gets every registered connection metadata
     */
    all: KernelConnectionMetadata[];
    readonly onControllerSelected: vscode.Event<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
    }>;
    readonly onControllerSelectionChanged: vscode.Event<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
        selected: boolean;
    }>;
    /**
     * Event fired when controllers are added or removed
     */
    readonly onDidChange: vscode.Event<IVSCodeNotebookControllerUpdateEvent>;
    getSelected(document: vscode.NotebookDocument): IVSCodeNotebookController | undefined;
    /**
     * Keeps track of controllers created for the active interpreter.
     * These are very special controllers, as they are created out of band even before kernel discovery completes.
     */
    trackActiveInterpreterControllers(controllers: IVSCodeNotebookController[]): void;
    /**
     * Registers a new controller or updates one. Disposing a controller unregisters it.
     * @return Returns the added and updated controller(s)
     */
    addOrUpdate(
        metadata: KernelConnectionMetadata,
        types: (typeof JupyterNotebookView | typeof InteractiveWindowView)[]
    ): IVSCodeNotebookController[];
    /**
     * Gets the controller for a particular connection
     * @param connection
     * @param notebookType
     */
    get(
        connection: KernelConnectionMetadata,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): IVSCodeNotebookController | undefined;
}

// Flag enum for the reason why a kernel was logged as an exact match
export enum PreferredKernelExactMatchReason {
    NoMatch = 0,
    OnlyKernel = 1 << 0,
    WasPreferredInterpreter = 1 << 1,
    IsExactMatch = 1 << 2,
    IsNonPythonKernelLanguageMatch = 1 << 3
}

export const IRemoteNotebookKernelSourceSelector = Symbol('IRemoteNotebookKernelSourceSelector');
export interface IRemoteNotebookKernelSourceSelector {
    selectRemoteKernel(
        notebook: vscode.NotebookDocument,
        provider: JupyterServerCollection
    ): Promise<RemoteKernelConnectionMetadata | undefined>;
}
export const ILocalNotebookKernelSourceSelector = Symbol('ILocalNotebookKernelSourceSelector');
export interface ILocalNotebookKernelSourceSelector {
    selectLocalKernel(notebook: vscode.NotebookDocument): Promise<LocalKernelConnectionMetadata | undefined>;
}
export const ILocalPythonNotebookKernelSourceSelector = Symbol('ILocalPythonNotebookKernelSourceSelector');
export interface ILocalPythonNotebookKernelSourceSelector {
    selectLocalKernel(notebook: vscode.NotebookDocument): Promise<PythonKernelConnectionMetadata | undefined>;
    getKernelConnection(env: EnvironmentPath): Promise<PythonKernelConnectionMetadata | undefined>;
}

export interface IConnectionDisplayData extends IDisposable {
    readonly onDidChange: vscode.Event<IConnectionDisplayData>;
    readonly label: string;
    readonly description: string | undefined;
    readonly detail: string;
    readonly category: string;
    readonly serverDisplayName?: string;
}

export const IConnectionDisplayDataProvider = Symbol('IConnectionDisplayData');
export interface IConnectionDisplayDataProvider {
    getDisplayData(connection: KernelConnectionMetadata): IConnectionDisplayData;
}
