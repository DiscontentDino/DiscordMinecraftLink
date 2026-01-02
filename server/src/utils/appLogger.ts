import { type Logger, pino } from 'pino';

export const logger = pino();

/**
 * The application logger.
 *
 * This logger supports hierarchical logging with trace context.
 */
export class AppLogger {
    /**
     * The shared singleton instance of the AppLogger.
     */
    private static shared = AppLogger.createRootLogger();

    /**
     * Pino's Logger instance.
     */
    private logger: Logger;
    /**
     * The trace context for this logger.
     */
    private trace: string[];

    /**
     * The private constructor for the AppLogger.
     * @param loggerInstance Pino's Logger instance.
     * @param trace The trace context for this logger.
     */
    private constructor(loggerInstance: Logger, trace: string[]) {
        this.logger = loggerInstance;
        this.trace = trace;
    }

    /**
     * Create the root logger used in the sigleton. All loggers derive from this root logger.
     * @returns The root AppLogger instance.
     */
    private static createRootLogger(): AppLogger {
        return new AppLogger(pino(), []);
    }

    /**
     * Get the root logger instance.
     * @returns The shared AppLogger instance.
     */
    public static root(): AppLogger {
        return AppLogger.shared;
    }

    /**
     * Create a child logger with additional trace context.
     * @param traceSegment The trace segment to add.
     * @returns A new AppLogger instance with the updated trace context.
     */
    public child(traceSegment: string | string[]): AppLogger {
        const newTrace = [
            ...this.trace,
            ...(Array.isArray(traceSegment) ? traceSegment : [traceSegment]),
        ];
        return new AppLogger(this.logger.child({}), newTrace);
    }

    /**
     * Log a debug message.
     * @param message The message to log.
     */
    public debug(message: string): void {
        this.logger.debug({ trace: this.trace }, message);
    }

    /**
     * Log an info message.
     * @param message The message to log.
     */
    public info(message: string): void {
        this.logger.info({ trace: this.trace }, message);
    }

    /**
     * Log a warning message.
     * @param message The message to log.
     */
    public warn(message: string): void {
        this.logger.warn({ trace: this.trace }, message);
    }

    /**
     * Log an error message.
     * @param message The message to log.
     */
    public error(message: string): void {
        this.logger.error({ trace: this.trace }, message);
    }
}
