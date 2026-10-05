/**
 * Incident taxonomy seed data.
 *
 * Four macro categories and nine sub-categories, each carrying the operational
 * priority and queue impact used for reporting. `baselineIncidentCount` and
 * `baselinePercentage` come from the historical 55-incident analysis and are
 * stored only so the report can compare live numbers against the baseline; new
 * categorizations never modify them.
 *
 * Idempotent: rows are matched on slug, so re-running only fills gaps and
 * refreshes the descriptive fields.
 */
import type { IncidentPriorityLevel } from '@helpdesk/shared';

export interface TaxonomySeedSubcategory {
  slug: string;
  name: string;
  description: string;
  priorityLevel: IncidentPriorityLevel;
  operationalImpact: string;
  baselineIncidentCount: number;
  baselinePercentage: number;
}

export interface TaxonomySeedCategory {
  slug: string;
  name: string;
  description: string;
  baselineIncidentCount: number;
  baselinePercentage: number;
  subcategories: TaxonomySeedSubcategory[];
}

export const TAXONOMY_SEED: TaxonomySeedCategory[] = [
  {
    slug: 'internet-issues',
    name: 'Internet Issues',
    description:
      'Connectivity, messaging and call-quality problems on the agent floor network.',
    baselineIncidentCount: 28,
    baselinePercentage: 50.91,
    subcategories: [
      {
        slug: 'internet-connectivity-issues',
        name: 'Internet Connectivity Issues',
        description:
          'Slow, unstable or completely failing internet connectivity at the workstation.',
        priorityLevel: 'critical',
        operationalImpact:
          'Total Queue Blackout: instantly drops all live chat and voice queues floor-wide; agents cannot accept incoming customer interactions.',
        baselineIncidentCount: 14,
        baselinePercentage: 25.5,
      },
      {
        slug: 'message-delivery-failures',
        name: 'Message Delivery Failures',
        description:
          'Chat messages that will not send, a disabled send button, or missing customer replies.',
        priorityLevel: 'high',
        operationalImpact:
          'Queue Latency: severe delays in customer text transmission, causing severe response-time delays and breaching chat SLAs.',
        baselineIncidentCount: 7,
        baselinePercentage: 12.7,
      },
      {
        slug: 'call-drops',
        name: 'Call Drops',
        description: 'Calls that disconnect unexpectedly, hang while loading, or cannot be returned.',
        priorityLevel: 'critical',
        operationalImpact:
          'Live Queue Abandonment: direct Customer Experience (CX) breach; cuts off live users mid-conversation.',
        baselineIncidentCount: 6,
        baselinePercentage: 10.9,
      },
      {
        slug: 'audio-issues-during-calls',
        name: 'Audio Issues During Calls',
        description: 'One-way or missing audio between the agent and the customer.',
        priorityLevel: 'high',
        operationalImpact:
          'Channel Restriction: causes one-way audio and severely degrades call communication quality; we can temporarily shift the agent to handle the live chat queue until a hardware swap occurs.',
        baselineIncidentCount: 1,
        baselinePercentage: 1.8,
      },
    ],
  },
  {
    slug: 'crm-issues',
    name: 'CRM Issues',
    description: 'Freshchat performance problems that lock the agent out of the live queue.',
    baselineIncidentCount: 22,
    baselinePercentage: 40.0,
    subcategories: [
      {
        slug: 'freshchat-lagging-freezing',
        name: 'Freshchat Lagging / Freezing',
        description:
          'Freshchat is slow or the workstation freezes, blocking the active chat interface.',
        priorityLevel: 'critical',
        operationalImpact:
          'Queue Stagnation: locks the active chat interface, preventing agents from replying to or clearing live incoming chat queues.',
        baselineIncidentCount: 22,
        baselinePercentage: 40.0,
      },
    ],
  },
  {
    slug: 'hardware-issues',
    name: 'Hardware Issues',
    description: 'Workstation, power and headset failures that take an agent offline.',
    baselineIncidentCount: 4,
    baselinePercentage: 7.27,
    subcategories: [
      {
        slug: 'pc-freezing',
        name: 'PC Freezing',
        description: 'The workstation freezes or stops responding during live work.',
        priorityLevel: 'high',
        operationalImpact:
          "Station Freeze: the agent's workstation locks up and they drop out of the live chat and voice queues until the machine recovers.",
        baselineIncidentCount: 2,
        baselinePercentage: 3.6,
      },
      {
        slug: 'power-outages',
        name: 'Power Outages',
        description: 'Loss of mains power at the workstation.',
        priorityLevel: 'critical',
        operationalImpact:
          'Station Blackout: shuts down all queue-handling hardware instantly, forcing an absolute stop to live operations.',
        baselineIncidentCount: 1,
        baselinePercentage: 1.8,
      },
      {
        slug: 'headset-malfunctions',
        name: 'Headset Malfunctions',
        description: 'Headsets that fail, distort or drop the agent from calls.',
        priorityLevel: 'high',
        operationalImpact:
          'Headset issue: completely pulls individual agents out of the active live queue; they can temporarily be shifted to another channel.',
        baselineIncidentCount: 1,
        baselinePercentage: 1.8,
      },
    ],
  },
  {
    slug: 'software-issues',
    name: 'Software Issues',
    description: 'Internal tooling problems with no direct customer-facing queue impact.',
    baselineIncidentCount: 1,
    baselinePercentage: 1.82,
    subcategories: [
      {
        slug: 'slack-issues',
        name: 'Slack Issues',
        description: 'Slack lag, missing notifications or the app failing to load.',
        priorityLevel: 'low',
        operationalImpact:
          'No Queue Impact: internal communication lag only; customer-facing channels remain fully active.',
        baselineIncidentCount: 1,
        baselinePercentage: 1.8,
      },
    ],
  },
];
