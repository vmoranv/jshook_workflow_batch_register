# batch-register workflow

Declarative example workflow for batch account registration.

## Entry File

- `workflow.ts`

## Workflow ID

- `workflow.batch-register.v1`

## Structure

This workflow demonstrates all core node types:

- `ToolNode`: precheck and summary steps
- `ParallelNode`: concurrent account registration
- `BranchNode`: success-rate-based branching
- `SequenceNode`: end-to-end orchestration

## Tools Used

- `web_api_capture_session` (precheck)
- `register_account_flow` (parallel tasks)
- `console_execute` (summary output)

## Config

- `workflows.batchRegister.maxConcurrency` (default: `3`)

## Local Validation

1. Load extension roots in `jshookmcp`.
2. Run `extensions_reload`.
3. Confirm workflow is listed in `extensions_list`.
4. Trigger the workflow via your workflow runner and verify:
   - parallel execution occurs
   - summary branch step emits result
