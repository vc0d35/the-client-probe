export type PortStateValue = "open" | "open-silent" | "closed";

export const PortState: {
	readonly Open: "open";
	readonly OpenSilent: "open-silent";
	readonly Closed: "closed";
};

export interface ProbeResult {
	host: string;
	port: number;
	state: PortStateValue;
	durationMs: number;
}

export declare function probeWithFetch(
	host: string,
	port: number,
): Promise<ProbeResult>;

export declare function probeWithIce(
	host: string,
	port: number,
): Promise<ProbeResult>;

export declare function scanPorts(
	host: string,
	ports: readonly number[],
): Promise<ProbeResult[]>;

export declare function scanPorts(
	host: string,
	min: number,
	max: number,
): Promise<ProbeResult[]>;
