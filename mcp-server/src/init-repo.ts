export type CiKind = "service" | "library" | "mobile" | "web";
export type Language = "swift" | "flutter" | "node" | "python" | "dotnet" | "mixed";

export interface InitOptions {
  language: Language;
  kind: CiKind;
  unitCoverageThreshold: number;
  integrationCoverageThreshold: number;
  /** For Swift: scheme name. */
  swiftScheme?: string;
  /** For Node: working dir / app slug for monorepos. */
  workingDirectory?: string;
  /** For service kind: Railway service name. */
  railwayServiceName?: string;
}

export interface InitResult {
  /** Proposed `.github/workflows/ci.yml` content. Agent presents this to the user before writing. */
  workflow: string;
  /** Notes the agent should surface to the user. */
  notes: string[];
}

const PERMISSIONS_BLOCK = `permissions:
  contents: read
  checks: write
  pull-requests: write
  security-events: write
  issues: write`;

const SCHEDULE_BLOCK = `  schedule:
    - cron: '0 2 * * 0'   # Sunday 02:00 UTC weekly security scan`;

// Shared `on:` preamble. paths-ignore prevents docs-only commits from burning
// GitHub Actions free-tier minutes (2000 Linux / 200 macOS per month for private repos).
const ON_PREAMBLE = `on:
  push:
    branches: [main, dev]
    paths-ignore:
      - 'docs/**'
      - '**/*.md'
      - 'LICENSE'
      - '.gitignore'
  pull_request:
    branches: [main, dev]
    paths-ignore:
      - 'docs/**'
      - '**/*.md'
      - 'LICENSE'
      - '.gitignore'`;

function qualityGate(language: Language): string {
  if (language === "mixed") return "quality-gate-node.yml"; // monorepo callers usually fan out
  return `quality-gate-${language}.yml`;
}

function securityScanLanguage(language: Language): string {
  switch (language) {
    case "swift":
      return "swift";
    case "flutter":
      return "java";
    case "dotnet":
      return "csharp";
    case "python":
      return "python";
    case "node":
    case "mixed":
      return "javascript-typescript";
  }
}

function libraryWorkflow(opts: InitOptions): string {
  return `name: CI

${ON_PREAMBLE}

${SCHEDULE_BLOCK}

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

${PERMISSIONS_BLOCK}

jobs:

  ci:
    if: github.event_name != 'schedule'
    uses: forgedTechApps/.github/.github/workflows/${qualityGate(opts.language)}@v1
    with:
      unit-coverage-threshold: '${opts.unitCoverageThreshold}'
      integration-coverage-threshold: '${opts.integrationCoverageThreshold}'
    secrets: inherit

  security-scan:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    uses: forgedTechApps/.github/.github/workflows/security-scan.yml@v1
    with:
      language: ${securityScanLanguage(opts.language)}
      enable-zap: false
    secrets: inherit
`;
}

function mobileWorkflow(opts: InitOptions): string {
  if (opts.language === "swift") {
    const scheme = opts.swiftScheme ?? "<SCHEME>";
    return `name: CI

${ON_PREAMBLE}

${SCHEDULE_BLOCK}

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

${PERMISSIONS_BLOCK}

jobs:

  ci:
    if: github.event_name != 'schedule'
    uses: forgedTechApps/.github/.github/workflows/quality-gate-swift.yml@v1
    with:
      scheme: '${scheme}'
      destination: 'platform=iOS Simulator,name=iPhone 15,OS=latest'
      xcode-version: 'latest-stable'
      unit-coverage-threshold: '${opts.unitCoverageThreshold}'
      integration-coverage-threshold: '${opts.integrationCoverageThreshold}'
      run-ui-tests: false
      ui-test-scheme: '${scheme}UITests'
    secrets: inherit

  security-scan:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    uses: forgedTechApps/.github/.github/workflows/security-scan.yml@v1
    with:
      language: swift
      enable-zap: false
    secrets: inherit
`;
  }
  if (opts.language === "flutter") {
    return `name: CI

${ON_PREAMBLE}

${SCHEDULE_BLOCK}

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

${PERMISSIONS_BLOCK}

jobs:

  ci:
    if: github.event_name != 'schedule'
    uses: forgedTechApps/.github/.github/workflows/quality-gate-flutter.yml@v1
    with:
      flutter-version: '3.x'
      unit-coverage-threshold: '${opts.unitCoverageThreshold}'
      integration-coverage-threshold: '${opts.integrationCoverageThreshold}'
      run-integration-tests: true
      build-android: true
      build-ios: false
    secrets: inherit

  security-scan:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    uses: forgedTechApps/.github/.github/workflows/security-scan.yml@v1
    with:
      language: java
      enable-zap: false
    secrets: inherit
`;
  }
  return libraryWorkflow(opts);
}

function serviceWorkflow(opts: InitOptions): string {
  const wd = opts.workingDirectory ?? ".";
  const svc = opts.railwayServiceName ?? "<service-name>";

  return `name: CI

${ON_PREAMBLE}

${SCHEDULE_BLOCK}

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

${PERMISSIONS_BLOCK}

jobs:

  ci:
    if: github.event_name != 'schedule'
    uses: forgedTechApps/.github/.github/workflows/${qualityGate(opts.language)}@v1
    with:
      unit-coverage-threshold: '${opts.unitCoverageThreshold}'
      integration-coverage-threshold: '${opts.integrationCoverageThreshold}'
      working-directory: '${wd}'
    secrets: inherit

  security-scan:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    uses: forgedTechApps/.github/.github/workflows/security-scan.yml@v1
    with:
      language: ${securityScanLanguage(opts.language)}
      enable-zap: false
    secrets: inherit

  deploy-dev:
    needs: [ci]
    if: needs.ci.result == 'success' && github.ref == 'refs/heads/dev' && github.event_name == 'push'
    uses: forgedTechApps/.github/.github/workflows/deploy-railway.yml@v1
    with:
      service-name: '${svc}-dev'
      environment: 'development'
      run-health-check: false
    secrets: inherit

  deploy:
    needs: [ci]
    if: needs.ci.result == 'success' && github.ref == 'refs/heads/main' && github.event_name == 'push'
    uses: forgedTechApps/.github/.github/workflows/deploy-railway.yml@v1
    with:
      service-name: '${svc}'
      environment: 'production'
      health-check-path: '/health'
    secrets: inherit
`;
}

function webWorkflow(opts: InitOptions): string {
  const svc = opts.railwayServiceName ?? "<service-name>";
  const wd = opts.workingDirectory ?? ".";

  return `name: CI

${ON_PREAMBLE}

${SCHEDULE_BLOCK}

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

${PERMISSIONS_BLOCK}

jobs:

  ci:
    if: github.event_name != 'schedule'
    uses: forgedTechApps/.github/.github/workflows/quality-gate-node.yml@v1
    with:
      node-version: '20'
      unit-coverage-threshold: '${opts.unitCoverageThreshold}'
      integration-coverage-threshold: '${opts.integrationCoverageThreshold}'
      run-e2e: false
      working-directory: '${wd}'
    secrets: inherit

  security-scan:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    uses: forgedTechApps/.github/.github/workflows/security-scan.yml@v1
    with:
      language: javascript-typescript
      enable-zap: true
      zap-target-url: \${{ secrets.RAILWAY_PUBLIC_URL }}
    secrets: inherit

  deploy-dev:
    needs: [ci]
    if: needs.ci.result == 'success' && github.ref == 'refs/heads/dev' && github.event_name == 'push'
    uses: forgedTechApps/.github/.github/workflows/deploy-railway.yml@v1
    with:
      service-name: '${svc}-dev'
      environment: 'development'
      run-health-check: false
    secrets: inherit

  deploy:
    needs: [ci]
    if: needs.ci.result == 'success' && github.ref == 'refs/heads/main' && github.event_name == 'push'
    uses: forgedTechApps/.github/.github/workflows/deploy-railway.yml@v1
    with:
      service-name: '${svc}'
      environment: 'production'
      health-check-path: '/'
    secrets: inherit
`;
}

export function generateCi(opts: InitOptions): InitResult {
  const notes: string[] = [];

  if (opts.kind === "mobile" && opts.language === "swift" && !opts.swiftScheme) {
    notes.push("swiftScheme not provided — placeholder '<SCHEME>' used. Replace before committing.");
  }
  if ((opts.kind === "service" || opts.kind === "web") && !opts.railwayServiceName) {
    notes.push("railwayServiceName not provided — placeholder '<service-name>' used. Replace before committing.");
  }
  if (opts.kind === "service" && opts.language === "swift") {
    notes.push("kind=service with language=swift is unusual. Confirm — most Swift backends are 'library' (Vapor) or use a different stack.");
  }

  let workflow: string;
  switch (opts.kind) {
    case "library":
      workflow = libraryWorkflow(opts);
      break;
    case "mobile":
      workflow = mobileWorkflow(opts);
      break;
    case "service":
      workflow = serviceWorkflow(opts);
      break;
    case "web":
      workflow = webWorkflow(opts);
      break;
  }

  notes.push("Branch protection is NOT set by this tool. Run: gh api -X PUT /repos/<org>/<repo>/branches/main/protection ...");
  notes.push("After committing this workflow, also commit a .agent-standards.yml at repo root.");

  return { workflow, notes };
}
