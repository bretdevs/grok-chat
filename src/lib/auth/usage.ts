import type { EventStream } from "@/lib/sse";
import type { Usage } from "@/lib/types";
import { defaultDailyLimit } from "./config";
import { one, query } from "./db";
import type { User } from "./users";

export type DailyUsage = { messages: number; inputTokens: number; outputTokens: number };

/** 0 means no limit. */
export function limitFor(user: User): number {
  return user.dailyLimit ?? defaultDailyLimit();
}

export async function usageToday(userId: string): Promise<DailyUsage> {
  const row = await one<{ messages: number; input_tokens: string; output_tokens: string }>(
    "select messages, input_tokens, output_tokens from usage_daily where user_id = $1 and day = current_date",
    [userId],
  );
  return {
    messages: row?.messages ?? 0,
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
  };
}

/**
 * Takes one message off today's allowance. The count and the check happen in a single statement,
 * so two requests at once can't both slip past the last message.
 */
export async function claimMessage(userId: string, limit: number): Promise<{ ok: boolean; used: number }> {
  const row = await one<{ messages: number }>(
    `insert into usage_daily (user_id, day, messages) values ($1, current_date, 1)
     on conflict (user_id, day) do update set messages = usage_daily.messages + 1
       where $2 <= 0 or usage_daily.messages < $2
     returning messages`,
    [userId, limit],
  );
  return row ? { ok: true, used: row.messages } : { ok: false, used: limit };
}

export function addTokens(userId: string, usage: Usage): void {
  void query(
    `insert into usage_daily (user_id, day, input_tokens, output_tokens) values ($1, current_date, $2, $3)
     on conflict (user_id, day) do update
       set input_tokens = usage_daily.input_tokens + $2, output_tokens = usage_daily.output_tokens + $3`,
    [userId, Math.max(0, usage.input), Math.max(0, usage.output + usage.reasoning)],
  ).catch(() => {});
}

/** Wraps the reply stream so the tokens a turn reports land on the account that spent them. */
export function meterStream(sse: EventStream, userId: string): EventStream {
  return {
    stream: sse.stream,
    send(event) {
      if (event.type === "done" && event.usage) addTokens(userId, event.usage);
      sse.send(event);
    },
    ping: () => sse.ping(),
    close: () => sse.close(),
    get closed() {
      return sse.closed;
    },
  };
}
