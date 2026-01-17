import { LogHub, LogLevel } from './LogHub';

function toMessage(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

export function installConsoleCapture(hub: LogHub): void {
  const original = {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const wrap =
    (level: LogLevel, fn: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      try {
        hub.add(level, toMessage(args));
      } catch {}
      fn(...args);
    };

  console.debug = wrap('debug', original.debug);
  console.info = wrap('info', original.info);
  console.log = wrap('info', original.log);
  console.warn = wrap('warn', original.warn);
  console.error = wrap('error', original.error);

  process.on('unhandledRejection', (reason) => {
    hub.add('error', `UnhandledRejection: ${toMessage([reason])}`);
  });

  process.on('uncaughtException', (err) => {
    hub.add('error', `UncaughtException: ${toMessage([err])}`);
  });
}

