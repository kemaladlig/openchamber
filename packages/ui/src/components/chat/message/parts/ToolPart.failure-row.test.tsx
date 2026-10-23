import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { plugin } from 'bun';
import { pathToFileURL } from 'node:url';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { OpenCode } from '@opencode/client';
import type { ToolPart as ToolPartData } from '@/lib/opencode/model';
import { SyncProvider } from '@/sync/sync-context';
import { I18nProvider } from '@/lib/i18n';

// Bun does not implement Vite's worker asset-query imports.
plugin({
  name: 'tool-failure-row-worker-url',
  setup(build) {
    build.onLoad({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, ({ path }) => ({
      contents: `export default ${JSON.stringify(pathToFileURL(path.split('?')[0]).href)};`,
      loader: 'js',
    }));
  },
});

const { default: ToolPart } = await import('./ToolPart');

const shellPart = (error: string, output?: string): ToolPartData => ({
  id: 'prt_shell_failure', sessionID: 'ses_shell_failure', messageID: 'msg_shell_failure',
  type: 'tool', tool: 'shell', callID: 'call_shell_failure',
  state: { status: 'error', input: { command: 'sudo true' }, error, output, metadata: {}, time: { start: 1, end: 2 } },
});

const readPart = (error: string): ToolPartData => ({
  id: 'prt_read_failure', sessionID: 'ses_read_failure', messageID: 'msg_read_failure',
  type: 'tool', tool: 'read', callID: 'call_read_failure',
  state: { status: 'error', input: { filePath: './missing.ts' }, error, metadata: {}, time: { start: 1, end: 2 } },
});

const renderRow = async (part: ToolPartData, isExpanded: boolean, run: (container: HTMLElement) => void) => {
  const happyWindow = new Window({ url: 'http://localhost' });
  const globals = {
    window: happyWindow,
    document: happyWindow.document,
    navigator: happyWindow.navigator,
    localStorage: happyWindow.localStorage,
    customElements: happyWindow.customElements,
    Node: happyWindow.Node,
    Text: happyWindow.Text,
    NodeList: happyWindow.NodeList,
    Element: happyWindow.Element,
    HTMLElement: happyWindow.HTMLElement,
    SVGElement: happyWindow.SVGElement,
    CustomEvent: happyWindow.CustomEvent,
    requestAnimationFrame: happyWindow.requestAnimationFrame.bind(happyWindow),
    cancelAnimationFrame: happyWindow.cancelAnimationFrame.bind(happyWindow),
    getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow),
    ResizeObserver: happyWindow.ResizeObserver,
    MutationObserver: happyWindow.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const sdk = OpenCode.make({
    baseUrl: 'http://localhost',
    fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
  });

  try {
    await act(async () => {
      root.render(
        <SyncProvider sdk={sdk} directory="">
          <I18nProvider>
            <ToolPart part={part} isExpanded={isExpanded} isMobile={false} onToggle={() => {}} />
          </I18nProvider>
        </SyncProvider>,
      );
    });
    run(container);
  } finally {
    await act(async () => { root.unmount(); });
    await happyWindow.happyDOM.abort();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
};

test('a failed shell row shows the reason its command printed, collapsed', async () => {
  const output = 'Password:\nsudo: a terminal is required to read the password\n';
  await renderRow(shellPart('exited (1)', output), false, (container) => {
    expect(container.textContent).toContain('sudo: a terminal is required to read the password');
    expect(container.textContent).toContain('sudo true');
  });
});

test('a failed shell row reads output that arrived in metadata, collapsed', async () => {
  const output = 'ls: cannot access \'/nonexistent\': No such file or directory\n';
  const part: ToolPartData = {
    id: 'prt_shell_metadata', sessionID: 'ses_shell_metadata', messageID: 'msg_shell_metadata',
    type: 'tool', tool: 'shell', callID: 'call_shell_metadata',
    state: { status: 'error', input: { command: 'ls /nonexistent' }, error: 'exited (2)', metadata: { output }, time: { start: 1, end: 2 } },
  };
  await renderRow(part, false, (container) => {
    expect(container.textContent).toContain('ls: cannot access \'/nonexistent\': No such file or directory');
  });
});

test('a failed tool that is not a shell shows its own error, collapsed', async () => {
  await renderRow(readPart('File not found: ./missing.ts'), false, (container) => {
    expect(container.textContent).toContain('File not found: ./missing.ts');
  });
});

test('an expanded failed row shows its error once', async () => {
  await renderRow(readPart('File not found: ./missing.ts'), true, (container) => {
    const shown = (container.textContent ?? '').split('File not found').length - 1;
    expect(shown).toBe(1);
  });
});
