import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';

import packageJson from './package.json' with { type: 'json' };
import { NullLogger, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { createProtocolConnection, ExitNotification, InitializeRequest, ShutdownRequest } from 'vscode-languageserver-protocol/node';

const TIMEOUT_MS = 10_000;
const servers = Object.entries((packageJson as { bin: Record<string, string> }).bin);

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function readStderr(stderr: NodeJS.ReadableStream | null): Promise<string> {
  if (!stderr) {
    return Promise.resolve('');
  }

  stderr.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let output = '';

    stderr.on('data', (chunk) => {
      output += chunk;
    });
    stderr.on('end', () => {
      resolve(output.trim());
    });
    stderr.on('error', reject);
  });
}

for (const [name, relativePath] of servers) {
  test(name, async () => {
    const path = join(import.meta.dir, relativePath);
    if (!(await Bun.file(path).exists())) {
      throw new Error(`Expected built server at ${relativePath}. Run bun ./script.mts first.`);
    }

    const child = spawn('node', [path, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
    const stderr = readStderr(child.stderr);

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

      expect(
        typeof initialize === 'object' &&
          initialize !== null &&
          'capabilities' in initialize,
      ).toBe(true);

      await withTimeout(connection.sendRequest(ShutdownRequest.type), `${name} shutdown`);
      connection.sendNotification(ExitNotification.type);

      const [code] = await withTimeout(exited, `${name} exit`);
      expect(code).toBe(0);
    } catch (error) {
      child.kill();
      const output = await stderr;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(output ? `${message}\n\n${output}` : message);
    } finally {
      connection.dispose();

      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }

      await exited.catch(() => undefined);
    }
  });
}
