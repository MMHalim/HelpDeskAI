/** Slack Events API payload shapes used by the bot (subset of the full API). */

export interface SlackEventEnvelope {
  token: string;
  team_id: string;
  api_app_id: string;
  event: SlackEvent;
  type: 'event_callback';
  event_id: string;
  event_time: number;
  // Socket Mode
  envelope_id?: string;
  accepts_response_payload?: boolean;
  retry_attempt?: number;
  retry_reason?: string;
}

export interface SlackUrlVerification {
  token: string;
  challenge: string;
  type: 'url_verification';
}

export interface SlackFileObject {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  width?: number;
  height?: number;
  url_private?: string;
  url_private_download?: string;
  permalink?: string;
  user?: string;
  is_public?: boolean;
  is_external?: boolean;
  external_url?: string;
  mode?: string;
  thumbnail?: string;
}

export interface SlackReaction {
  name: string;
  users: string[];
  count: number;
}

interface BaseEvent {
  type: string;
  event_ts?: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  files?: SlackFileObject[];
  attachments?: Array<Record<string, unknown>>;
}

export interface ReactionAddedEvent extends BaseEvent {
  type: 'reaction_added';
  reaction: string;
  item_user?: string;
  item?: { type: string; channel?: string; ts?: string };
}

export interface MessageEvent extends BaseEvent {
  type: 'message';
  channel_type?: string;
  client_msg_id?: string;
  team?: string;
}

export interface AppMentionEvent extends BaseEvent {
  type: 'app_mention';
}

export interface FileSharedEvent extends BaseEvent {
  type: 'file_shared';
  file: SlackFileObject;
  upload_mode?: string;
}

export interface FileChangeEvent extends BaseEvent {
  type: 'file_change';
  file_id: string;
  file: { id: string };
}

export type SlackEvent =
  | ReactionAddedEvent
  | MessageEvent
  | AppMentionEvent
  | FileSharedEvent
  | FileChangeEvent;

export interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  parent_user_id?: string;
  files?: SlackFileObject[];
  permalink?: string;
}

export interface SlackUserInfo {
  id: string;
  team_id?: string;
  name?: string;
  real_name?: string;
  tz?: string;
  is_bot?: boolean;
  deleted?: boolean;
  profile?: {
    display_name?: string;
    real_name?: string;
    email?: string;
    image_72?: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Interactivity (Block Kit)                                                   */
/* -------------------------------------------------------------------------- */

export interface SlackBlockAction {
  action_id?: string;
  block_id?: string;
  type?: string;
  value?: string;
}

export interface SlackBlockActionPayload {
  type: string;
  team?: { id?: string; domain?: string };
  user?: { id?: string; username?: string; name?: string };
  channel?: { id?: string; name?: string };
  message?: {
    ts?: string;
    thread_ts?: string;
    text?: string;
    blocks?: Array<Record<string, unknown>>;
    user?: string;
    bot_id?: string;
  };
  actions?: SlackBlockAction[];
  response_url?: string;
  trigger_id?: string;
}
