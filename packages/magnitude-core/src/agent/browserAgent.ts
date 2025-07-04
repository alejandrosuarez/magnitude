import { BrowserContext, Page } from "playwright";
import { Agent, AgentOptions } from ".";
import { BrowserConnector, BrowserConnectorOptions } from "@/connectors/browserConnector";
import { buildDefaultBrowserAgentOptions } from "@/ai/util";
import { LLMClient } from "@/ai/types";
import { Schema, ZodSchema } from "zod";
import z from "zod";
import { renderMinimalAccessibilityTree } from "@/web/util";
import { narrateAgent, narrateBrowserAgent } from "./narrator";
import EventEmitter from "eventemitter3";

// export interface StartAgentWithWebOptions {
//     agentBaseOptions?: Partial<AgentOptions>;
//     webConnectorOptions?: BrowserConnectorOptions;
// }

const DEFAULT_BROWSER_AGENT_TEMP = 0.2;

// Helper function to start a web agent
export async function startBrowserAgent(
    options?: AgentOptions & BrowserConnectorOptions & { narrate?: boolean }//StartAgentWithWebOptions = {}
): Promise<BrowserAgent> {
    const { agentOptions, browserOptions } = buildDefaultBrowserAgentOptions({ agentOptions: options ?? {}, browserOptions: options ?? {} });

    const agent = new BrowserAgent({
        agentOptions: agentOptions,
        browserOptions: browserOptions,
    });

    if (options?.narrate || process.env.MAGNITUDE_NARRATE) {
        narrateBrowserAgent(agent);
        //agent.events.on('actionStarted', (action: any) => { console.log(action) })
    }

    await agent.start();
    return agent;
}

// Anything that could be extracted with a zod schema
type ExtractedOutput =
    | string
    | number
    | boolean
    | bigint
    | Date
    | null
    | undefined
    | { [key: string]: ExtractedOutput }
    | ExtractedOutput[];

export interface BrowserAgentEvents {
    'nav': (url: string) => void;
    'extractStarted': (instructions: string, schema: ZodSchema) => void;
    'extractDone': (instructions: string, data: ExtractedOutput) => void;
}

export class BrowserAgent extends Agent {
    public readonly browserAgentEvents: EventEmitter<BrowserAgentEvents> = new EventEmitter();

    constructor({ agentOptions, browserOptions }: { agentOptions?: Partial<AgentOptions>, browserOptions?: BrowserConnectorOptions }) {
        //console.log("agent options:", agent);
        super({
            ...agentOptions,
            connectors: [new BrowserConnector(browserOptions || {}), ...(agentOptions?.connectors ?? [])]
        });
    }

    get page(): Page {
        return this.require(BrowserConnector).getHarness().page;
    }

    get context(): BrowserContext {
        return this.require(BrowserConnector).getHarness().context;
    }

    async nav(url: string): Promise<void> {
        this.browserAgentEvents.emit('nav', url);
        await this.require(BrowserConnector).getHarness().navigate(url);
    }

    async extract<T extends Schema>(instructions: string, schema: T): Promise<z.infer<T>> {
        this.browserAgentEvents.emit('extractStarted', instructions, schema);
        //const htmlContent = await this.page.content();
        const accessibilityTree = await this.page.accessibility.snapshot({ interestingOnly: true });
        const pageRepr = renderMinimalAccessibilityTree(accessibilityTree);
        const screenshot = await this.require(BrowserConnector).getHarness().screenshot();
        const data = await this.model.extract(instructions, schema, screenshot, pageRepr);

        this.browserAgentEvents.emit('extractDone', instructions, data);

        return data;
    }

    // async check(description: string): Promise<boolean> {
    //     //const screenshot = await this.require(BrowserConnector).getHarness().screenshot();
    //     return await this.macro.check(description, screenshot);
    // }
}
