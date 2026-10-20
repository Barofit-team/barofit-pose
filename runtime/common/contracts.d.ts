/** Metadata for frame/result transport; frame timestamps are monotonic milliseconds. */
export type Landmark = [number|null, number|null, number|null, number|null, number|null];
export interface PoseFrame {
  timestampMs: number;
  width: number;
  height: number;
  /** Exactly 33 MediaPipe anatomical landmark IDs. */
  landmarks: Landmark[];
}
export type ItemStatus = 'within_reference' | 'warning' | 'tracking_unavailable' |
  'pending_feedback' | 'body_unavailable' | 'body_deviation' | 'interrupted';
export interface FrameResult {
  schemaVersion: '1.0';
  exercise: string;
  engineVersion: string;
  timestampMs: number;
  ignored: boolean;
  tracking: 'tracking' | 'selecting_side' | 'tracking_unavailable';
  side: 'left' | 'right' | null;
  count: number | null;
  /** Reserved. Plank timer is not implemented in v0.1.0. */
  holdSeconds: number | null;
  codes: string[];
  items: Record<string, ItemStatus> | null;
  /** Existing push-up event timestamps t/start_s/bottom_s/end_s are in seconds. */
  events: Array<Record<string, unknown>>;
  metrics: Record<string, unknown> | null;
}
