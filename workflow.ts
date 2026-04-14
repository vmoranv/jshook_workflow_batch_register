import type { WorkflowContract, WorkflowExecutionContext } from '@jshookmcp/extension-sdk/workflow';
import { createWorkflow, toolNode, sequenceNode, parallelNode } from '@jshookmcp/extension-sdk/workflow';

interface BatchAccountConfig {
  fields?: Record<string, unknown>;
  submitSelector?: string;
  emailProviderUrl?: string;
  verificationLinkPattern?: string;
  checkboxSelectors?: string[];
  includeConfirmPassword?: boolean;
  confirmPasswordFieldName?: string;
  extraFields?: Record<string, unknown>;
  timeoutMs?: number;
  emailPollingWaitMs?: number;
  authMinConfidence?: number;
}

const workflowId = 'workflow.batch-register.v1';
const configPrefix = 'workflows.batchRegister';

function normalizeAccounts(rawValue: unknown): BatchAccountConfig[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      fields:
        item.fields && typeof item.fields === 'object'
          ? (item.fields as Record<string, unknown>)
          : undefined,
      submitSelector: typeof item.submitSelector === 'string' ? item.submitSelector : undefined,
      emailProviderUrl: typeof item.emailProviderUrl === 'string' ? item.emailProviderUrl : undefined,
      verificationLinkPattern:
        typeof item.verificationLinkPattern === 'string' ? item.verificationLinkPattern : undefined,
      checkboxSelectors: Array.isArray(item.checkboxSelectors)
        ? item.checkboxSelectors.filter((value): value is string => typeof value === 'string')
        : undefined,
      includeConfirmPassword:
        typeof item.includeConfirmPassword === 'boolean' ? item.includeConfirmPassword : undefined,
      confirmPasswordFieldName:
        typeof item.confirmPasswordFieldName === 'string' ? item.confirmPasswordFieldName : undefined,
      extraFields:
        item.extraFields && typeof item.extraFields === 'object'
          ? (item.extraFields as Record<string, unknown>)
          : undefined,
      timeoutMs: typeof item.timeoutMs === 'number' ? item.timeoutMs : undefined,
      emailPollingWaitMs: typeof item.emailPollingWaitMs === 'number' ? item.emailPollingWaitMs : undefined,
      authMinConfidence: typeof item.authMinConfidence === 'number' ? item.authMinConfidence : undefined,
    }));
}

function buildRegisterWorkflowConfig(
  registerUrl: string,
  defaultSubmitSelector: string,
  defaultVerificationLinkPattern: string,
  defaultTimeoutMs: number,
  defaultEmailPollingWaitMs: number,
  defaultAuthMinConfidence: number,
  account: BatchAccountConfig,
) {
  const fields = account.fields ?? {};
  const username = typeof fields.username === 'string' ? fields.username : `demo-user-${Math.random().toString(36).slice(2, 8)}`;
  const email = typeof fields.email === 'string' ? fields.email : '';
  const password = typeof fields.password === 'string' ? fields.password : '';

  if (!email || !password) {
    throw new Error('[workflow.batch-register] Each account must provide fields.email and fields.password');
  }

  const extraFields: Record<string, unknown> = {
    ...(account.extraFields ?? {}),
  };

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'username' || key === 'email' || key === 'password') {
      continue;
    }
    extraFields[key] = value;
  }

  return {
    workflows: {
      registerAccount: {
        registerUrl,
        username,
        email,
        password,
        submitSelector: account.submitSelector ?? defaultSubmitSelector,
        emailProviderUrl: account.emailProviderUrl ?? '',
        verificationLinkPattern:
          account.verificationLinkPattern ?? defaultVerificationLinkPattern,
        checkboxSelectors: account.checkboxSelectors ?? [],
        includeConfirmPassword: account.includeConfirmPassword ?? true,
        confirmPasswordFieldName: account.confirmPasswordFieldName ?? 'checkPassword',
        extraFields,
        timeoutMs: account.timeoutMs ?? defaultTimeoutMs,
        emailPollingWaitMs: account.emailPollingWaitMs ?? defaultEmailPollingWaitMs,
        authMinConfidence: account.authMinConfidence ?? defaultAuthMinConfidence,
      },
    },
  };
}

export default createWorkflow(workflowId, 'Batch Register Accounts')
  .description(
    'Run the external register-account-flow workflow for multiple accounts with configurable concurrency, retry policy, and per-account overrides.',
  )
  .tags(['workflow', 'registration', 'batch', 'automation'])
  .timeoutMs(15 * 60_000)
  .defaultMaxConcurrency(3)
  .buildGraph((ctx: WorkflowExecutionContext) => {
    const registerWorkflowId = ctx.getConfig<string>(
      `${configPrefix}.registerWorkflowId`,
      'workflow.register-account-flow.v1',
    );
    const registerUrl = ctx.getConfig<string>(`${configPrefix}.registerUrl`, '');
    if (!registerUrl) {
      throw new Error('[workflow.batch-register] Missing required config: workflows.batchRegister.registerUrl');
    }

    const defaultSubmitSelector = ctx.getConfig<string>(
      `${configPrefix}.submitSelector`,
      "button[type='submit']",
    );
    const defaultVerificationLinkPattern = ctx.getConfig<string>(
      `${configPrefix}.verificationLinkPattern`,
      '/api/v1/auths/activate',
    );
    const maxConcurrency = ctx.getConfig<number>(`${configPrefix}.maxConcurrency`, 3);
    const maxAttempts = ctx.getConfig<number>(`${configPrefix}.maxAttempts`, 2);
    const retryBackoffMs = ctx.getConfig<number>(`${configPrefix}.retryBackoffMs`, 1_000);
    const retryMultiplier = ctx.getConfig<number>(`${configPrefix}.retryMultiplier`, 2);
    const timeoutPerAccountMs = ctx.getConfig<number>(`${configPrefix}.timeoutPerAccountMs`, 90_000);
    const defaultEmailPollingWaitMs = ctx.getConfig<number>(
      `${configPrefix}.emailPollingWaitMs`,
      6_000,
    );
    const defaultAuthMinConfidence = ctx.getConfig<number>(
      `${configPrefix}.authMinConfidence`,
      0.3,
    );

    const accounts = normalizeAccounts(ctx.getConfig<unknown>(`${configPrefix}.accounts`, []));
    if (accounts.length === 0) {
      throw new Error('[workflow.batch-register] Missing required config: workflows.batchRegister.accounts');
    }

    const parallel = parallelNode('register-parallel')
      .maxConcurrency(Math.max(1, maxConcurrency))
      .failFast(false);

    accounts.forEach((account, index) => {
      const registerConfig = buildRegisterWorkflowConfig(
        registerUrl,
        defaultSubmitSelector,
        defaultVerificationLinkPattern,
        timeoutPerAccountMs,
        defaultEmailPollingWaitMs,
        defaultAuthMinConfidence,
        account,
      );

      parallel.step(
        toolNode(`register-account-${index + 1}`, 'run_extension_workflow')
          .input({
            workflowId: registerWorkflowId,
            config: registerConfig,
          })
          .retry({
            maxAttempts: Math.max(1, maxAttempts),
            backoffMs: Math.max(0, retryBackoffMs),
            multiplier: Math.max(1, retryMultiplier),
          })
          .timeout(timeoutPerAccountMs + 60_000),
      );
    });

    return sequenceNode('batch-register-root')
      .step(
        toolNode('batch-register-summary', 'console_execute').input({
          expression: `(${JSON.stringify({
            status: 'batch_register_started',
            workflowId,
            registerWorkflowId,
            registerUrl,
            accountCount: accounts.length,
            maxConcurrency,
            maxAttempts,
            retryBackoffMs,
            retryMultiplier,
            timeoutPerAccountMs,
          })})`,
        }),
      )
      .step(parallel)
      .step(
        toolNode('batch-register-finish', 'console_execute').input({
          expression: `(${JSON.stringify({
            status: 'batch_register_completed',
            workflowId,
            registerWorkflowId,
            accountCount: accounts.length,
            note: 'Inspect run_extension_workflow step outputs for per-account success or failure details.',
          })})`,
        }),
      );
  })
  .onStart((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId,
      stage: 'start',
    });
  })
  .onFinish((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId,
      stage: 'finish',
    });
  })
  .onError((ctx, error) => {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', {
      workflowId,
      error: error.name,
    });
  })
  .build();
