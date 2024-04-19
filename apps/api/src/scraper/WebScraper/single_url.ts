import * as cheerio from "cheerio";
import { ScrapingBeeClient } from "scrapingbee";
import { extractMetadata } from "./utils/metadata";
import dotenv from "dotenv";
import { Document, PageOptions } from "../../lib/entities";
import { parseMarkdown } from "../../lib/html-to-markdown";
import { parseTablesToMarkdown } from "./utils/parseTable";
import { excludeNonMainTags } from "./utils/excludeTags";
// import puppeteer from "puppeteer";

dotenv.config();

export async function scrapWithCustomFirecrawl(
  url: string,
  options?: any
): Promise<string> {
  try {
    // TODO: merge the custom firecrawl scraper into mono-repo when ready
    return null;
  } catch (error) {
    console.error(`Error scraping with custom firecrawl-scraper: ${error}`);
    return "";
  }
}

export async function scrapWithScrapingBee(
  url: string,
  wait_browser: string = "domcontentloaded"
): Promise<string> {
  try {
    const client = new ScrapingBeeClient(process.env.SCRAPING_BEE_API_KEY);
    const response = await client.get({
      url: url,
      params: { timeout: 15000, wait_browser: wait_browser },
      headers: { "ScrapingService-Request": "TRUE" },
    });

    if (response.status !== 200 && response.status !== 404) {
      console.error(
        `Scraping bee error in ${url} with status code ${response.status}`
      );
      return "";
    }
    const decoder = new TextDecoder();
    const text = decoder.decode(response.data);
    return text;
  } catch (error) {
    console.error(`Error scraping with Scraping Bee: ${error}`);
    return "";
  }
}

export async function scrapWithPlaywright(url: string): Promise<string> {
  try {
    const response = await fetch(process.env.PLAYWRIGHT_MICROSERVICE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: url }),
    });

    if (!response.ok) {
      console.error(
        `Error fetching w/ playwright server -> URL: ${url} with status: ${response.status}`
      );
      return "";
    }

    const data = await response.json();
    const html = data.content;
    return html ?? "";
  } catch (error) {
    console.error(`Error scraping with Puppeteer: ${error}`);
    return "";
  }
}

export async function scrapSingleUrl(
  urlToScrap: string,
  toMarkdown: boolean = true,
  pageOptions: PageOptions = { onlyMainContent: true }
): Promise<Document> {
  console.log(`Scraping URL: ${urlToScrap}`);
  urlToScrap = urlToScrap.trim();

  const removeUnwantedElements = (html: string, pageOptions: PageOptions) => {
    const soup = cheerio.load(html);
    soup("script, style, iframe, noscript, meta, head").remove();
    
    // remove any other tags that are not in the main content
    if (pageOptions?.onlyMainContent) return excludeNonMainTags(html);
    else return soup.html();
  };

  const attemptScraping = async (
    url: string,
    method:
      | "firecrawl-scraper"
      | "scrapingBee"
      | "playwright"
      | "scrapingBeeLoad"
      | "fetch"
  ) => {
    let text = "";
    switch (method) {
      case "firecrawl-scraper":
        text = await scrapWithCustomFirecrawl(url);
        break;
      case "scrapingBee":
        if (process.env.SCRAPING_BEE_API_KEY) {
          text = await scrapWithScrapingBee(url);
        }
        break;
      case "playwright":
        if (process.env.PLAYWRIGHT_MICROSERVICE_URL) {
          text = await scrapWithPlaywright(url);
        }
        break;
      case "scrapingBeeLoad":
        if (process.env.SCRAPING_BEE_API_KEY) {
          text = await scrapWithScrapingBee(url, "networkidle2");
        }
        break;
      case "fetch":
        try {
          const response = await fetch(url);
          if (!response.ok) {
            console.error(
              `Error fetching URL: ${url} with status: ${response.status}`
            );
            return "";
          }
          text = await response.text();
        } catch (error) {
          console.error(`Error scraping URL: ${error}`);
          return "";
        }
        break;
    }
    let cleanedHtml = removeUnwantedElements(text, pageOptions);
    return [await parseMarkdown(cleanedHtml), text];
  };

  try {
    // TODO: comment this out once we're ready to merge firecrawl-scraper into the mono-repo
    // let [text, html] = await attemptScraping(urlToScrap, 'firecrawl-scraper');
    // if (!text || text.length < 100) {
    //   console.log("Falling back to scraping bee load");
    //   [text, html] = await attemptScraping(urlToScrap, 'scrapingBeeLoad');
    // }

    let [text, html] = await attemptScraping(urlToScrap, "scrapingBee");
    if (!text || text.length < 100) {
      console.log("Falling back to playwright");
      [text, html] = await attemptScraping(urlToScrap, "playwright");
    }

    if (!text || text.length < 100) {
      console.log("Falling back to scraping bee load");
      [text, html] = await attemptScraping(urlToScrap, "scrapingBeeLoad");
    }
    if (!text || text.length < 100) {
      console.log("Falling back to fetch");
      [text, html] = await attemptScraping(urlToScrap, "fetch");
    }

    const soup = cheerio.load(html);
    const metadata = extractMetadata(soup, urlToScrap);

    return {
      content: text,
      markdown: text,
      metadata: { ...metadata, sourceURL: urlToScrap },
    } as Document;
  } catch (error) {
    console.error(`Error: ${error} - Failed to fetch URL: ${urlToScrap}`);
    return {
      content: "",
      markdown: "",
      metadata: { sourceURL: urlToScrap },
    } as Document;
  }
}
