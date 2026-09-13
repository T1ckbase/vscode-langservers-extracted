import { expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ConfigurationRequest,
  createProtocolConnection,
  DefinitionRequest,
  DidChangeConfigurationNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  DocumentLinkRequest,
  ExitNotification,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  Location,
  ShutdownRequest,
  type ProtocolConnection,
} from 'vscode-languageserver-protocol/node';

import packageJson from './package.json' with { type: 'json' };

class LspClient implements AsyncDisposable {
  private exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  constructor(
    public child: ChildProcess,
    public conn: ProtocolConnection,
  ) {
    this.exited =
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
        : new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  }

  static async start(binPath: string, initOptions = {}) {
    const child = spawn('node', [binPath, '--stdio']);
    const conn = createProtocolConnection(child.stdout!, child.stdin!);
    conn.listen();

    const client = new LspClient(child, conn);
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        (async () => {
          await conn.sendRequest(InitializeRequest.type, {
            processId: process.pid,
            rootUri: null,
            capabilities: {},
            clientInfo: { name: 'test' },
            ...initOptions,
          });
          await conn.sendNotification(InitializedNotification.type, {});
        })(),
        new Promise<never>((_, reject) => {
          child.once('error', reject);
          timer = setTimeout(() => reject(new Error('Server initialization timed out')), 4000);
          timer.unref();
        }),
      ]);
      return client;
    } catch (error) {
      await client[Symbol.asyncDispose]().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async [Symbol.asyncDispose]() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { code, signal } = await Promise.race([
        (async () => {
          if (this.child.exitCode === null && this.child.signalCode === null) {
            try {
              await this.conn.sendRequest(ShutdownRequest.type);
              await this.conn.sendNotification(ExitNotification.type);
            } catch {
              // Ignore connection broken errors if process terminated early
            }
          }
          return await this.exited;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Server process failed to exit within 3s')), 3000);
          timer.unref();
        }),
      ]);
      if (signal !== null) {
        throw new Error(`Server process terminated by signal ${signal}`);
      }
      if (code !== 0) {
        throw new Error(`Server process exited with code ${code}`);
      }
    } finally {
      clearTimeout(timer);
      this.child.kill();
      this.conn.dispose();
    }
  }
}

test('vscode-html-language-server', async () => {
  await using client = await LspClient.start(packageJson.bin['vscode-html-language-server']);

  const uri = 'file:///test.html';
  await client.conn.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: {
      uri,
      languageId: 'html',
      version: 1,
      text: '<script>Uint8Array.fromBase64("SGVsbG8=")</script>\n',
    },
  });

  const hover = await client.conn.sendRequest(HoverRequest.type, {
    textDocument: { uri },
    position: { line: 0, character: 24 },
  });

  expect(JSON.stringify(hover)).toContain('Creates a new `Uint8Array` from a base64-encoded string.');

  const definition = await client.conn.sendRequest(DefinitionRequest.type, {
    textDocument: { uri },
    position: { line: 0, character: 24 },
  });

  expect(definition).toBeArray();
  if (Array.isArray(definition)) {
    const loc = definition[0];
    expect(Location.is(loc)).toBe(true);
    if (Location.is(loc)) {
      expect(loc.uri).toStartWith('file:///');
      expect(loc.uri).toContain('typescript/lib/lib.esnext');
    }
  }
});

test('vscode-css-language-server', async () => {
  await using client = await LspClient.start(packageJson.bin['vscode-css-language-server']);

  const uri = 'file:///test.css';
  await client.conn.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: {
      uri,
      languageId: 'css',
      version: 1,
      text: 'button { text-box: normal; }\n',
    },
  });

  const hover = await client.conn.sendRequest(HoverRequest.type, {
    textDocument: { uri },
    position: { line: 0, character: 16 },
  });

  expect(JSON.stringify(hover)).toContain('MDN Reference');
});

test('vscode-json-language-server', async () => {
  await using client = await LspClient.start(packageJson.bin['vscode-json-language-server'], {
    capabilities: {
      textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] } },
    },
  });

  await client.conn.sendNotification(DidChangeConfigurationNotification.type, {
    settings: {
      json: {
        schemas: [
          {
            fileMatch: ['*test.json'],
            uri: 'custom://schema.json',
            schema: {
              properties: {
                foo: { description: 'Description of foo property' },
              },
            },
          },
        ],
      },
    },
  });

  const uri = 'file:///test.json';
  await client.conn.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: {
      uri,
      languageId: 'json',
      version: 1,
      text: '{\n  "foo": 123\n}\n',
    },
  });

  const hover = await client.conn.sendRequest(HoverRequest.type, {
    textDocument: { uri },
    position: { line: 1, character: 4 },
  });

  expect(JSON.stringify(hover)).toContain('Description of foo property');
});

test('vscode-markdown-language-server', async () => {
  await using client = await LspClient.start(packageJson.bin['vscode-markdown-language-server']);

  client.conn.onRequest('markdown/parse', () => []);

  const uri = 'file:///test.md';
  await client.conn.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: {
      uri,
      languageId: 'markdown',
      version: 1,
      text: '[Neovim](https://neovim.io)\n',
    },
  });

  const links = await client.conn.sendRequest(DocumentLinkRequest.type, {
    textDocument: { uri },
  });

  expect(links).toHaveLength(1);
  expect(links![0]!.target).toBe('https://neovim.io/');
});

test('vscode-eslint-language-server', async () => {
  await using client = await LspClient.start(packageJson.bin['vscode-eslint-language-server'], {
    capabilities: {
      workspace: { configuration: true },
      textDocument: { diagnostic: { dynamicRegistration: true } },
    },
  });

  client.conn.onRequest(ConfigurationRequest.type, () => [
    {
      validate: 'on',
      options: {
        overrideConfigFile: true,
        overrideConfig: [{ rules: { 'no-unused-vars': 'error' } }],
      },
    },
  ]);

  const uri = pathToFileURL(join(process.cwd(), 'test.js')).href;
  await client.conn.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: {
      uri,
      languageId: 'javascript',
      version: 1,
      text: 'const x = 1;\n',
    },
  });

  const result = await client.conn.sendRequest(DocumentDiagnosticRequest.type, {
    textDocument: { uri },
  });

  expect(result.kind).toBe('full');
  if (result.kind === 'full') {
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.code).toBe('no-unused-vars');
    expect(result.items[0]!.message).toContain('assigned a value but never used');
  }
}, 10000);
