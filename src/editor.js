/**
 * src/editor.js — CodeMirror 6 barrel export for esbuild.
 *
 * esbuild bundles all of these into public/cm.bundle.js as a single IIFE.
 * Because everything comes from one bundle, there is exactly one copy of
 * @codemirror/state and @codemirror/view — no more "multiple instances" error.
 *
 * Exported symbols are available in the browser as properties of window.CM.
 */

// Core
export { EditorView, Decoration, WidgetType } from '@codemirror/view';
export { EditorState, Compartment, StateField, StateEffect } from '@codemirror/state';
export { basicSetup }                          from 'codemirror';

// Dark theme
export { oneDark }                             from '@codemirror/theme-one-dark';

// Language support
export { python }                              from '@codemirror/lang-python';
export { javascript }                          from '@codemirror/lang-javascript';
export { java }                                from '@codemirror/lang-java';
export { cpp }                                 from '@codemirror/lang-cpp';
export { csharp }                              from '@replit/codemirror-lang-csharp';
