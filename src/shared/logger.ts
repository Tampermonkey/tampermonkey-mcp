/* eslint-disable @typescript-eslint/no-explicit-any */
type ERROR = 0;
type WARN = 30;
type DEBUG = 60;
type VERBOSE = 80;

const ERROR: ERROR = 0;
const WARN: WARN = 30;
const DEBUG: DEBUG = 60;
const VERBOSE: VERBOSE = 80;

type LogLevel = 0 | WARN | DEBUG | VERBOSE | 90 | 100;
type LogLevelChangeListener = (l: Logger, ll: LogLevel) => void;
type LogFunction = {
    (...data: any[]): void;
    (message?: any, ...optionalParams: any[]): void;
};

interface Logger {
    set: (log_level: LogLevel, force_std_err?: boolean) => void;
    get: () => LogLevel;
    verbose: LogFunction;
    debug: LogFunction;
    log: LogFunction;
    warn: LogFunction;
    info: LogFunction;
    error: LogFunction;
    addChangeListener: (f: LogLevelChangeListener) => void;
}
type LoggerMethods = keyof Logger;

let  logLevel: LogLevel = ERROR;
const listeners: LogLevelChangeListener[] = [];

const setuplog = () => {
    const V: LoggerMethods[] = [ 'debug' ];
    const D: LoggerMethods[] = [ 'log' ];
    const W: LoggerMethods[] = [ 'warn', 'info'];
    const E: LoggerMethods[] = [ 'error' ];
    const ALL = [ ...V, ...D, ...W, ...E ];
    const tc = E;

    if (logLevel >= VERBOSE)  {
        tc.push(...V);
    }
    if (logLevel >= DEBUG)  {
        tc.push(...D);
    }
    if (logLevel >= WARN)  {
        tc.push(...W);
    }
    ALL.forEach((k) => {
        const o = forceStdErr ? 'error' : k;
        logger[k] = tc.includes(k) ? (console as any)[o].bind(console) : () => undefined;
    });
};

let forceStdErr = false;
const logger: Logger = {
    set: (log_level: LogLevel, force_std_err = false): void => {
        logLevel = log_level;
        forceStdErr = force_std_err;

        listeners.forEach(l => {
            l(logger, logLevel);
        });

        setuplog();
    },
    get: (): LogLevel => {
        return logLevel;
    },
    get verbose(): LogFunction { return (logger.debug || (() => undefined)).bind(console) }, // verbose logging is only called for debugging (non-minified) code
    debug: () => undefined,
    log: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
    addChangeListener: (f: LogLevelChangeListener): void => {
        listeners.push(f);
    }
};

setuplog();

export {
    logger,
    Logger,
    LogLevel,
    ERROR,
    WARN,
    DEBUG,
    VERBOSE
};