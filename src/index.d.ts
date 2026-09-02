export type PortStateValue = "open" | "open-silent" | "closed" | "restricted";

export const PortState: {
	readonly Open: "open";
	readonly OpenSilent: "open-silent";
	readonly Closed: "closed";
	readonly Restricted: "restricted";
};

export interface ProbeResult {
	host: string;
	port: number;
	state: PortStateValue;
	durationMs: number;
}

export const RESTRICTED_PORTS: ReadonlySet<number>;

export declare function probeWithFetch(
	host: string,
	port: number,
	timeoutMs?: number,
): Promise<ProbeResult>;

export declare function probeWithIce(
	host: string,
	port: number,
	timeoutMs?: number,
): Promise<ProbeResult>;

export declare function probeBatchWithIce(
	host: string,
	ports: readonly number[],
	timeoutMs?: number,
): Promise<ProbeResult[]>;

export interface ScanProgress {
	completed: number;
	total: number;
	result: ProbeResult;
}

export interface ScanOptions {
	/** Hang timeout for fetch probes (ports < 1024). Default 2000. */
	fetchTimeoutMs?: number;
	/** Per-batch deadline for ICE probes (ports >= 1024). Default batchSize * 100 + 500. */
	iceTimeoutMs?: number;
	onProgress?: (progress: ScanProgress) => void;
}

export declare function scanPorts(
	host: string,
	ports: readonly number[],
	options?: ScanOptions,
): Promise<ProbeResult[]>;

export declare function scanPorts(
	host: string,
	min: number,
	max: number,
	options?: ScanOptions,
): Promise<ProbeResult[]>;
