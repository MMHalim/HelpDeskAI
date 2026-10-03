/**
 * Idempotent development seed: ensures an administrator exists and adds a few
 * starter knowledge-base articles.
 */
import { randomBytes } from 'node:crypto';
import type { ArticleInput } from '@helpdesk/shared';
import { env } from '../env.js';
import { closeDatabase } from './client.js';
import { runMigrations } from './migrate.js';
import { createUser, listUsers } from '../modules/auth/service.js';
import { createArticle } from '../modules/knowledge/articles.js';
import { logger } from '../lib/logger.js';

const SEED_ARTICLES: Array<Partial<ArticleInput> & { title: string; category: string }> = [
  {
    title: 'Reset a user password in Active Directory',
    category: 'Accounts & Access',
    issueDescription: 'A user cannot sign in because their password expired or was forgotten.',
    symptoms: ['Login fails with "password incorrect"', 'Account lockout notification'],
    troubleshootingSteps:
      '1. Open Active Directory Users and Computers.\n2. Locate the user account.\n3. Right-click and choose Reset Password.\n4. Set a temporary password and require change at next logon.\n5. Ask the user to sign in and set a new password.',
    expectedResult: 'The user can sign in with the new password.',
    keywords: ['password', 'reset', 'login', 'active directory', 'account'],
    tags: ['identity', 'password'],
  },
  {
    title: 'Reconnect a network printer',
    category: 'Hardware',
    issueDescription: 'A network printer shows offline or jobs stay queued.',
    symptoms: ['Printer status is Offline', 'Print jobs stuck in queue', 'Ping to printer IP fails'],
    troubleshootingSteps:
      '1. Confirm the printer is powered on and connected to the network.\n2. Print a configuration page to read its IP address.\n3. Ping the printer IP from the workstation.\n4. Remove and re-add the printer.\n5. Restart the print spooler service.',
    expectedResult: 'The printer returns to Ready and jobs print.',
    keywords: ['printer', 'offline', 'print queue', 'spooler'],
    tags: ['printer', 'network'],
  },
  {
    title: 'Clear an Outlook cache and reconnect the account',
    category: 'Email & Collaboration',
    issueDescription: 'Outlook fails to sync, shows disconnected, or crashes on launch.',
    symptoms: ['Outlook shows "Disconnected"', 'Mail not updating', 'Prompts for credentials repeatedly'],
    troubleshootingSteps:
      '1. Close Outlook.\n2. Open Control Panel > Mail > Show Profiles.\n3. Remove the affected profile.\n4. Recreate the profile and sign in.\n5. Let Outlook rebuild the OST cache.',
    expectedResult: 'Outlook reconnects and syncs mail normally.',
    keywords: ['outlook', 'email', 'sync', 'profile', 'cache'],
    tags: ['outlook', 'email'],
  },
];

async function main(): Promise<void> {
  await runMigrations();

  const users = await listUsers();
  if (users.length === 0) {
    const password = env.ADMIN_PASSWORD.length >= 12 ? env.ADMIN_PASSWORD : randomBytes(18).toString('base64url');
    await createUser({ email: env.ADMIN_EMAIL, name: 'Administrator', password, role: 'admin' });
    if (env.ADMIN_PASSWORD.length >= 12) {
      logger.info({ email: env.ADMIN_EMAIL }, 'Created administrator account');
    } else {
      logger.warn({ email: env.ADMIN_EMAIL, password }, 'Created administrator with generated password');
    }
  } else {
    logger.info({ count: users.length }, 'Users already exist, skipping administrator seed');
  }

  const admin = (await listUsers())[0];
  if (admin) {
    for (const article of SEED_ARTICLES) {
      await createArticle(
        {
          title: article.title,
          category: article.category,
          issueDescription: article.issueDescription ?? '',
          symptoms: article.symptoms ?? [],
          troubleshootingSteps: article.troubleshootingSteps ?? '',
          expectedResult: article.expectedResult ?? '',
          failureResult: '',
          nextStep: '',
          escalationInstructions: '',
          tags: article.tags ?? [],
          keywords: article.keywords ?? [],
          priority: 'normal',
          isActive: true,
          notes: '',
          steps: [],
          images: [],
        } as ArticleInput,
        { id: admin.id, email: admin.email },
      );
    }
    logger.info({ articles: SEED_ARTICLES.length }, 'Seeded starter knowledge-base articles');
  }

  await closeDatabase();
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Seeding failed');
  process.exit(1);
});
