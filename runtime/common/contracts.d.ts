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
  'pending_feedback' | 'body_unavailable' | 'body_deviation' | 'interrupted' |
  'unknown' | 'not_applicable' | 'disabled' | 'not_supported';
/** Common app-facing snapshot. Exercise is the discriminator; v1 research outputs are separate. */
export interface FrameResultBase {
  schemaVersion: '2.0';
  type: 'frame.result';
  engineVersion: string;
  timestampMs: number;
  ignored: boolean;
  ignoredReason: 'finished' | 'non_monotonic_timestamp' | null;
  tracking: 'tracking' | 'selecting_side' | 'tracking_unavailable';
  side: 'left' | 'right' | null;
  count: number | null;
  holdSeconds: number | null;
  observedSeconds: number | null;
  measurementBasis: {
    count: 'completed_attempt' | 'one_leg_out_and_back' | 'completed_open_close_attempt' | 'completed_raise_lower_attempt' | 'completed_bridge_raise_lower_attempt' | 'completed_superman_raise_lower_attempt' | 'completed_pike_lower_raise_attempt' | null;
    holdSeconds: 'all_required_items_compliant' | 'observed_holding' | 'observed_raised_still' | null;
    observedSeconds: 'continuous_sample_intervals' | 'continuous_visible_intervals' | null;
  };
  /** Engine movement stage; null where not exposed. Not frontend session lifecycle. */
  phase: string | null;
  /** Current observation ONLY. No entry means not emitted, never automatically compliant. */
  items: Record<string, ItemStatus>;
  /** Existing display candidates, possibly mixing current and recent-repetition feedback. Not a TTS command. */
  codes: string[];
  currentCodes: string[];
  /** Last repetition while the original engine's feedback display window is active; otherwise null. */
  lastRepetition: {
    number: number | null; timestampMs: number | null;
    items: Record<string, ItemStatus>; codes: string[]; metrics: Record<string, unknown>;
  } | null;
  metrics: Record<string, unknown>;
  /** Legacy engine events unchanged. Their t/start_s/end_s fields are seconds. */
  events: Array<{type: string; [key: string]: unknown}>;
}
export interface PushupFrameResult extends FrameResultBase {
  exercise: 'pushup';
  holdSeconds: null; observedSeconds: null; phase: null;
  details: {diagnostics?: unknown; hipStatus?: string | null};
}
export interface PlankFrameResult extends FrameResultBase {
  exercise: 'plank'; count: null; phase: null; lastRepetition: null;
  details: {raw?: Record<string, unknown>};
}
export interface BirdDogFrameResult extends FrameResultBase {
  exercise: 'bird_dog'; lastRepetition: null;
  details: {
    sideCounts?: {left: number; right: number};
    holdingSides?: Array<'left' | 'right'>;
    body?: Record<string, unknown>;
    enginePhase?: string;
    referenceStatus?: string; experimental?: boolean; thresholdBasis?: string;
  };
}
export interface JumpingJackFrameResult extends FrameResultBase {
  exercise: 'jumping_jack'; count: number; holdSeconds: null; details: Record<string, never>;
}
export interface LegRaiseFrameResult extends FrameResultBase {
  exercise: 'leg_raise'; count: number; holdSeconds: null; details: Record<string, never>;
}
export interface GluteBridgeFrameResult extends FrameResultBase {
  exercise: 'glute_bridge'; count: number; holdSeconds: null; details: Record<string, never>;
}
export type FrameResult = PushupFrameResult | PlankFrameResult | BirdDogFrameResult | JumpingJackFrameResult | LegRaiseFrameResult | GluteBridgeFrameResult | SupermanFrameResult | PikePushupFrameResult;

/** Set-result v2 unchanged. Non-terminal engine event payloads retain their v1 contracts. */
export interface ItemSummary {
  aggregationBasis: 'repetition' | 'time';
  unit: 'repetitions' | 'seconds';
  compliant: number;
  warning: number;
  unknown: number;
  notApplicable: number;
  evaluated: number;
  /** 0–100 inclusive; null when evaluated === 0. */
  compliancePct: number | null;
}
export interface SetSummary {
  schemaVersion: '2.0';
  exercise: string;
  engineVersion: string;
  count: number | null;
  holdSeconds: number | null;
  observedSeconds: number | null;
  gapSeconds: number | null;
  items: Record<string, ItemSummary>;
  details: Record<string, unknown>;
}
export interface SetCompleted {
  schemaVersion: '2.0';
  type: 'set.completed';
  exercise: string;
  engineVersion: string;
  /** Same time origin as input PoseFrame, milliseconds; null before the first frame. */
  timestampMs: number | null;
  summary: SetSummary;
}

export interface SupermanFrameResult extends FrameResultBase {
 exercise: 'superman'; count: number; holdSeconds: number; details: Record<string, never>;
}

export interface PikePushupFrameResult extends FrameResultBase {
 exercise: 'pike_pushup'; count: number; holdSeconds: null; details: Record<string, never>;
}
