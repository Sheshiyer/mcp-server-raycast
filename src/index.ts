#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface CreateExtensionArgs {
  name: string;
  title: string;
  description?: string;
  mode?: 'view' | 'no-view';
  language?: 'typescript' | 'javascript';
  template?: 'default' | 'detail' | 'form' | 'grid' | 'list';
  path?: string;
}

interface BuildExtensionArgs {
  path: string;
  mode?: 'development' | 'production';
}

interface PublishExtensionArgs {
  path: string;
  version?: string;
}

const isCreateExtensionArgs = (args: unknown): args is CreateExtensionArgs => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return typeof a.name === 'string' && typeof a.title === 'string';
};

const isBuildExtensionArgs = (args: unknown): args is BuildExtensionArgs => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return typeof a.path === 'string';
};

const isPublishExtensionArgs = (args: unknown): args is PublishExtensionArgs => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return typeof a.path === 'string';
};

class RaycastServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'raycast-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_extension',
          description: 'Create a new Raycast extension project',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Extension name (package name)',
              },
              title: {
                type: 'string',
                description: 'Extension title (display name)',
              },
              description: {
                type: 'string',
                description: 'Extension description',
              },
              mode: {
                type: 'string',
                enum: ['view', 'no-view'],
                description: 'Extension mode',
                default: 'view',
              },
              language: {
                type: 'string',
                enum: ['typescript', 'javascript'],
                description: 'Programming language',
                default: 'typescript',
              },
              template: {
                type: 'string',
                enum: ['default', 'detail', 'form', 'grid', 'list'],
                description: 'Extension template',
                default: 'default',
              },
              path: {
                type: 'string',
                description: 'Directory to create the extension in',
              },
            },
            required: ['name', 'title'],
          },
        },
        {
          name: 'build_extension',
          description: 'Build a Raycast extension',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to extension directory',
              },
              mode: {
                type: 'string',
                enum: ['development', 'production'],
                description: 'Build mode',
                default: 'development',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'publish_extension',
          description: 'Publish a Raycast extension',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to extension directory',
              },
              version: {
                type: 'string',
                description: 'Version to publish (e.g., 1.0.0)',
              },
            },
            required: ['path'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'create_extension': {
          if (!isCreateExtensionArgs(request.params.arguments)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid create_extension arguments'
            );
          }
          return this.handleCreateExtension(request.params.arguments);
        }
        case 'build_extension': {
          if (!isBuildExtensionArgs(request.params.arguments)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid build_extension arguments'
            );
          }
          return this.handleBuildExtension(request.params.arguments);
        }
        case 'publish_extension': {
          if (!isPublishExtensionArgs(request.params.arguments)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid publish_extension arguments'
            );
          }
          return this.handlePublishExtension(request.params.arguments);
        }
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async handleCreateExtension(args: CreateExtensionArgs) {
    try {
      const extensionPath = args.path || process.cwd();
      const fullPath = path.join(extensionPath, args.name);

      // Create extension directory
      fs.mkdirSync(fullPath, { recursive: true });

      // Initialize npm project
      execSync('npm init -y', { cwd: fullPath });

      // Install dependencies
      execSync('npm install --save @raycast/api', { cwd: fullPath });
      execSync('npm install --save-dev @raycast/utils @types/node typescript', { cwd: fullPath });

      // Create package.json with Raycast configuration
      const packageJson = {
        name: args.name,
        version: '1.0.0',
        title: args.title,
        description: args.description || '',
        icon: 'command-icon.png',
        author: 'raycast',
        license: 'MIT',
        commands: [
          {
            name: 'index',
            title: args.title,
            description: args.description || '',
            mode: args.mode || 'view',
          },
        ],
        dependencies: {
          '@raycast/api': '^1.0.0',
        },
        devDependencies: {
          '@raycast/utils': '^1.0.0',
          '@types/node': '^20.0.0',
          typescript: '^5.0.0',
        },
        scripts: {
          build: 'ray build -e src/index.ts',
          dev: 'ray develop',
        },
      };

      fs.writeFileSync(
        path.join(fullPath, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create tsconfig.json
      const tsConfig = {
        compilerOptions: {
          target: 'es2020',
          lib: ['es2020'],
          module: 'commonjs',
          moduleResolution: 'node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
        },
        include: ['src/**/*'],
      };

      fs.writeFileSync(
        path.join(fullPath, 'tsconfig.json'),
        JSON.stringify(tsConfig, null, 2)
      );

      // Create src directory and index file
      fs.mkdirSync(path.join(fullPath, 'src'));
      
      const indexContent = `import { List } from "@raycast/api";

export default function Command() {
  return (
    <List>
      <List.Item title="Hello World" />
    </List>
  );
}
`;

      fs.writeFileSync(path.join(fullPath, 'src', 'index.ts'), indexContent);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created Raycast extension "${args.name}" at ${fullPath}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create extension: ${errorMessage}`
      );
    }
  }

  private async handleBuildExtension(args: BuildExtensionArgs) {
    try {
      const buildMode = args.mode || 'development';
      execSync(`npm run ${buildMode === 'development' ? 'dev' : 'build'}`, {
        cwd: args.path,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully built extension in ${buildMode} mode`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to build extension: ${errorMessage}`
      );
    }
  }

  private async handlePublishExtension(args: PublishExtensionArgs) {
    try {
      if (args.version) {
        execSync(`npm version ${args.version}`, { cwd: args.path });
      }

      execSync('ray publish', { cwd: args.path });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully published extension${
              args.version ? ` version ${args.version}` : ''
            }`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to publish extension: ${errorMessage}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Raycast MCP server running on stdio');
  }
}

const server = new RaycastServer();
server.run().catch(console.error);