/**
 * The growth funnel, aggregated in one pass. Pure: the caller supplies the
 * (small — this is a 25-user program) rows, this counts them.
 *
 * The funnel is per channel: campaign links group by their code, referral and
 * direct arrivals get their own buckets. Every stage is measured against
 * accounts that actually authenticated — link opens before authentication are
 * not in the data, and the report does not pretend they are.
 */

export type AttributionSource = "campaign" | "referral" | "direct";

export interface FunnelInputs {
  attributions: Array<{
    userId: string;
    source: AttributionSource;
    campaignCode: string | null;
    firstSeenAt: string;
  }>;
  wnftByUser: Map<string, "provisional" | "confirmed" | "rejected">;
  fundedUserIds: Set<string>;
  lastActivityByUser: Map<string, string>;
  spendByCampaign: Map<string, number>;
  /** Days after first-seen an account must still be trading to count as D7. */
  retentionDays: number;
}

export interface FunnelRow {
  channel: string;
  source: AttributionSource;
  campaignCode: string | null;
  authedUsers: number;
  fundedUsers: number;
  wnftProvisional: number;
  wnftConfirmed: number;
  wnftRejected: number;
  d7Active: number;
  spendUsd: number;
  /** spend / funded, or null when there is no spend or nobody funded. */
  cacUsd: number | null;
}

export interface FunnelReport {
  channels: FunnelRow[];
  totals: Omit<FunnelRow, "channel" | "source" | "campaignCode">;
}

function isD7Active(
  firstSeenAt: string,
  lastActivityAt: string | undefined,
  retentionMs: number,
): boolean {
  if (!lastActivityAt) return false;
  const first = new Date(firstSeenAt).getTime();
  const last = new Date(lastActivityAt).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
  return last - first >= retentionMs;
}

export function buildGrowthFunnel(inputs: FunnelInputs): FunnelReport {
  const retentionMs = inputs.retentionDays * 24 * 60 * 60 * 1000;
  const rows = new Map<string, FunnelRow>();

  for (const attribution of inputs.attributions) {
    // Campaigns key on their code; referral and direct on the source label, so
    // every account lands in exactly one channel bucket.
    const channel = attribution.campaignCode ?? `(${attribution.source})`;
    let row = rows.get(channel);
    if (!row) {
      row = {
        channel,
        source: attribution.source,
        campaignCode: attribution.campaignCode,
        authedUsers: 0,
        fundedUsers: 0,
        wnftProvisional: 0,
        wnftConfirmed: 0,
        wnftRejected: 0,
        d7Active: 0,
        spendUsd: attribution.campaignCode
          ? (inputs.spendByCampaign.get(attribution.campaignCode) ?? 0)
          : 0,
        cacUsd: null,
      };
      rows.set(channel, row);
    }

    row.authedUsers += 1;
    if (inputs.fundedUserIds.has(attribution.userId)) {
      row.fundedUsers += 1;
    }
    const status = inputs.wnftByUser.get(attribution.userId);
    if (status === "provisional") row.wnftProvisional += 1;
    else if (status === "confirmed") row.wnftConfirmed += 1;
    else if (status === "rejected") row.wnftRejected += 1;
    if (
      isD7Active(
        attribution.firstSeenAt,
        inputs.lastActivityByUser.get(attribution.userId),
        retentionMs,
      )
    ) {
      row.d7Active += 1;
    }
  }

  const channels = [...rows.values()].map((row) => ({
    ...row,
    cacUsd: row.spendUsd > 0 && row.fundedUsers > 0
      ? row.spendUsd / row.fundedUsers
      : null,
  }));
  // Busiest channels first.
  channels.sort((a, b) => b.authedUsers - a.authedUsers);

  const totalSpend = channels.reduce((sum, row) => sum + row.spendUsd, 0);
  const totalFunded = channels.reduce((sum, row) => sum + row.fundedUsers, 0);
  const totals = {
    authedUsers: channels.reduce((sum, row) => sum + row.authedUsers, 0),
    fundedUsers: totalFunded,
    wnftProvisional: channels.reduce((sum, row) => sum + row.wnftProvisional, 0),
    wnftConfirmed: channels.reduce((sum, row) => sum + row.wnftConfirmed, 0),
    wnftRejected: channels.reduce((sum, row) => sum + row.wnftRejected, 0),
    d7Active: channels.reduce((sum, row) => sum + row.d7Active, 0),
    spendUsd: totalSpend,
    cacUsd: totalSpend > 0 && totalFunded > 0 ? totalSpend / totalFunded : null,
  };

  return { channels, totals };
}
