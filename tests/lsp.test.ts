import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';

import { NullLogger, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import {
  createProtocolConnection,
  ExitNotification,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  ShutdownRequest,
} from 'vscode-languageserver-protocol/node';

import packageJson from '../package.json' with { type: 'json' };

const TIMEOUT_MS = 10_000;
const STDERR_TIMEOUT_MS = 1_000;
const servers = Object.entries(packageJson.bin);

async function withTimeout<T>(promise: Promise<T>, label: string, ms = TIMEOUT_MS): Promise<T> {
  let timeout: NodeJS.Timeout;
  const timer = new Promise<never>(
    (_, reject) => (timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  );
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

for (const [name, relativePath] of servers) {
  test(name, async () => {
    const path = join(import.meta.dir, '..', relativePath);
    if (!(await Bun.file(path).exists())) {
      throw new Error(`Expected built server at ${relativePath}. Run bun run build first.`);
    }

    const child = spawn('node', [path, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        child.off('error', onError);
        resolve([code, signal]);
      };

      const onError = (error: Error) => {
        child.off('exit', onExit);
        reject(error);
      };

      child.once('exit', onExit);
      child.once('error', onError);
    });
    const stderr = child.stderr ? text(child.stderr) : Promise.resolve('');

    const connection = createProtocolConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
      NullLogger,
    );

    connection.listen();

    try {
      const initialize = await withTimeout(
        connection.sendRequest(InitializeRequest.type, {
          processId: null,
          rootUri: null,
          capabilities: {},
          clientInfo: { name: 'bun-test' },
        }),
        `${name} initialize`,
      );

      expect(initialize).toMatchObject({ capabilities: expect.anything() });
      connection.sendNotification(InitializedNotification.type, {});

      if (name === 'vscode-html-language-server') {
        const uri = 'file:///test.html';
        await connection.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: 'html',
            version: 1,
            text: '<script>Uint8Array.fromBase64("SGVsbG8=")</script>',
          },
        });

        const hover = await withTimeout(
          connection.sendRequest(HoverRequest.type, {
            textDocument: { uri },
            position: { line: 0, character: 24 },
          }),
          `${name} hover`,
        );

        expect(JSON.stringify(hover)).toContain('alphabet');
      }

      await withTimeout(connection.sendRequest(ShutdownRequest.type), `${name} shutdown`);
      connection.sendNotification(ExitNotification.type);

      const [code] = await withTimeout(exited, `${name} exit`);
      expect(code).toBe(0);
    } catch (error) {
      child.kill();
      const output = await withTimeout(stderr, `${name} stderr`, STDERR_TIMEOUT_MS).catch(() => '');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(output ? `${message}\n\n${output}` : message);
    } finally {
      connection.dispose();

      child.kill();

      await withTimeout(exited, `${name} exit`, STDERR_TIMEOUT_MS).catch(() => undefined);
    }
  });
}
