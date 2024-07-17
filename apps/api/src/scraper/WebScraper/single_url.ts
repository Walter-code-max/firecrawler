import * as cheerio from "cheerio";
import { extractMetadata } from "./utils/metadata";
import dotenv from "dotenv";
import {
  Document,
  PageOptions,
  FireEngineResponse,
  ExtractorOptions,
} from "../../lib/entities";
import { parseMarkdown } from "../../lib/html-to-markdown";
import { urlSpecificParams } from "./utils/custom/website_params";
import { fetchAndProcessPdf } from "./utils/pdfProcessor";
import { handleCustomScraping } from "./custom/handleCustomScraping";
import { removeUnwantedElements } from "./utils/removeUnwantedElements";
import { scrapWithFetch } from "./scrapers/fetch";
import { scrapWithFireEngine } from "./scrapers/fireEngine";
import { scrapWithPlaywright } from "./scrapers/playwright";
import { scrapWithScrapingBee } from "./scrapers/scrapingBee";

dotenv.config();

const baseScrapers = [
  "fire-engine",
  "scrapingBee",
  "playwright",
  "scrapingBeeLoad",
  "fetch",
] as const;

export async function generateRequestParams(
  url: string,
  wait_browser: string = "domcontentloaded",
  timeout: number = 15000
): Promise<any> {
  const defaultParams = {
    url: url,
    params: { timeout: timeout, wait_browser: wait_browser },
    headers: { "ScrapingService-Request": "TRUE" },
  };

  try {
    const urlKey = new URL(url).hostname.replace(/^www\./, "");
    if (urlSpecificParams.hasOwnProperty(urlKey)) {
      return { ...defaultParams, ...urlSpecificParams[urlKey] };
    } else {
      return defaultParams;
    }
  } catch (error) {
    console.error(`Error generating URL key: ${error}`);
    return defaultParams;
  }
}

/**
 * Get the order of scrapers to be used for scraping a URL
 * If the user doesn't have envs set for a specific scraper, it will be removed from the order.
 * @param defaultScraper The default scraper to use if the URL does not have a specific scraper order defined
 * @returns The order of scrapers to be used for scraping a URL
 */
function getScrapingFallbackOrder(
  defaultScraper?: string,
  isWaitPresent: boolean = false,
  isScreenshotPresent: boolean = false,
  isHeadersPresent: boolean = false
) {
  const availableScrapers = baseScrapers.filter((scraper) => {
    switch (scraper) {
      case "scrapingBee":
      case "scrapingBeeLoad":
        return !!process.env.SCRAPING_BEE_API_KEY;
      case "fire-engine":
        return !!process.env.FIRE_ENGINE_BETA_URL;
      case "playwright":
        return !!process.env.PLAYWRIGHT_MICROSERVICE_URL;
      default:
        return true;
    }
  });

  let defaultOrder = [
    "scrapingBee",
    "fire-engine",
    "playwright",
    "scrapingBeeLoad",
    "fetch",
  ];

  if (isWaitPresent || isScreenshotPresent || isHeadersPresent) {
    defaultOrder = [
      "fire-engine",
      "playwright",
      ...defaultOrder.filter(
        (scraper) => scraper !== "fire-engine" && scraper !== "playwright"
      ),
    ];
  }

  const filteredDefaultOrder = defaultOrder.filter(
    (scraper: (typeof baseScrapers)[number]) =>
      availableScrapers.includes(scraper)
  );
  const uniqueScrapers = new Set(
    defaultScraper
      ? [defaultScraper, ...filteredDefaultOrder, ...availableScrapers]
      : [...filteredDefaultOrder, ...availableScrapers]
  );

  const scrapersInOrder = Array.from(uniqueScrapers);
  return scrapersInOrder as (typeof baseScrapers)[number][];
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];

  // Parse the base URL to get the origin
  const urlObject = new URL(baseUrl);
  const origin = urlObject.origin;

  $('a').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        // Absolute URL, add as is
        links.push(href);
      } else if (href.startsWith('/')) {
        // Relative URL starting with '/', append to origin
        links.push(`${origin}${href}`);
      } else if (!href.startsWith('#') && !href.startsWith('mailto:')) {
        // Relative URL not starting with '/', append to base URL
        links.push(`${baseUrl}/${href}`);
      } else if (href.startsWith('mailto:')) {
        // mailto: links, add as is
        links.push(href);
      }
      // Fragment-only links (#) are ignored
    }
  });

  // Remove duplicates and return
  return [...new Set(links)];
}

export async function scrapSingleUrl(
  urlToScrap: string,
  pageOptions: PageOptions = {
    onlyMainContent: true,
    includeHtml: false,
    includeRawHtml: false,
    waitFor: 0,
    screenshot: false,
    headers: undefined,
  },
  extractorOptions: ExtractorOptions = {
    mode: "llm-extraction-from-markdown",
  },
  existingHtml: string = ""
): Promise<Document> {
  urlToScrap = urlToScrap.trim();

  const attemptScraping = async (
    url: string,
    method: (typeof baseScrapers)[number]
  ) => {
    let scraperResponse: {
      text: string;
      screenshot: string;
      metadata: { pageStatusCode?: number; pageError?: string | null };
    } = { text: "", screenshot: "", metadata: {} };
    let screenshot = "";
    switch (method) {
      case "fire-engine":
        if (process.env.FIRE_ENGINE_BETA_URL) {
          console.log(`Scraping ${url} with Fire Engine`);
          const response = await scrapWithFireEngine({
            url,
            waitFor: pageOptions.waitFor,
            screenshot: pageOptions.screenshot,
            pageOptions: pageOptions,
            headers: pageOptions.headers,
          });
          scraperResponse.text = response.html;
          scraperResponse.screenshot = response.screenshot;
          scraperResponse.metadata.pageStatusCode = response.pageStatusCode;
          scraperResponse.metadata.pageError = response.pageError;
        }
        break;
      case "scrapingBee":
        if (process.env.SCRAPING_BEE_API_KEY) {
          const response = await scrapWithScrapingBee(
            url,
            "domcontentloaded",
            pageOptions.fallback === false ? 7000 : 15000
          );
          scraperResponse.text = response.content;
          scraperResponse.metadata.pageStatusCode = response.pageStatusCode;
          scraperResponse.metadata.pageError = response.pageError;
        }
        break;
      case "playwright":
        if (process.env.PLAYWRIGHT_MICROSERVICE_URL) {
          const response = await scrapWithPlaywright(
            url,
            pageOptions.waitFor,
            pageOptions.headers
          );
          scraperResponse.text = response.content;
          scraperResponse.metadata.pageStatusCode = response.pageStatusCode;
          scraperResponse.metadata.pageError = response.pageError;
        }
        break;
      case "scrapingBeeLoad":
        if (process.env.SCRAPING_BEE_API_KEY) {
          const response = await scrapWithScrapingBee(url, "networkidle2");
          scraperResponse.text = response.content;
          scraperResponse.metadata.pageStatusCode = response.pageStatusCode;
          scraperResponse.metadata.pageError = response.pageError;
        }
        break;
      case "fetch":
        const response = await scrapWithFetch(url);
        scraperResponse.text = response.content;
        scraperResponse.metadata.pageStatusCode = response.pageStatusCode;
        scraperResponse.metadata.pageError = response.pageError;
        break;
    }

    let customScrapedContent: FireEngineResponse | null = null;

    // Check for custom scraping conditions
    const customScraperResult = await handleCustomScraping(
      scraperResponse.text,
      url
    );

    if (customScraperResult) {
      switch (customScraperResult.scraper) {
        case "fire-engine":
          customScrapedContent = await scrapWithFireEngine({
            url: customScraperResult.url,
            waitFor: customScraperResult.waitAfterLoad,
            screenshot: false,
            pageOptions: customScraperResult.pageOptions,
          });
          if (screenshot) {
            customScrapedContent.screenshot = screenshot;
          }
          break;
        case "pdf":
          const { content, pageStatusCode, pageError } =
            await fetchAndProcessPdf(
              customScraperResult.url,
              pageOptions?.parsePDF
            );
          customScrapedContent = {
            html: content,
            screenshot,
            pageStatusCode,
            pageError,
          };
          break;
      }
    }

    if (customScrapedContent) {
      scraperResponse.text = customScrapedContent.html;
      screenshot = customScrapedContent.screenshot;
    }
    //* TODO: add an optional to return markdown or structured/extracted content
    let cleanedHtml = removeUnwantedElements(scraperResponse.text, pageOptions);
    return {
      text: await parseMarkdown(cleanedHtml),
      html: cleanedHtml,
      rawHtml: scraperResponse.text,
      screenshot: scraperResponse.screenshot,
      pageStatusCode: scraperResponse.metadata.pageStatusCode,
      pageError: scraperResponse.metadata.pageError || undefined,
    };
  };

  let { text, html, rawHtml, screenshot, pageStatusCode, pageError } = {
    text: "",
    html: "",
    rawHtml: "",
    screenshot: "",
    pageStatusCode: 200,
    pageError: undefined,
  };
  try {
    let urlKey = urlToScrap;
    try {
      urlKey = new URL(urlToScrap).hostname.replace(/^www\./, "");
    } catch (error) {
      console.error(`Invalid URL key, trying: ${urlToScrap}`);
    }
    const defaultScraper = urlSpecificParams[urlKey]?.defaultScraper ?? "";
    const scrapersInOrder = getScrapingFallbackOrder(
      defaultScraper,
      pageOptions && pageOptions.waitFor && pageOptions.waitFor > 0,
      pageOptions && pageOptions.screenshot && pageOptions.screenshot === true,
      pageOptions && pageOptions.headers && pageOptions.headers !== undefined
    );

    for (const scraper of scrapersInOrder) {
      // If exists text coming from crawler, use it
      if (existingHtml && existingHtml.trim().length >= 100) {
        let cleanedHtml = removeUnwantedElements(existingHtml, pageOptions);
        text = await parseMarkdown(cleanedHtml);
        html = cleanedHtml;
        break;
      }

      const attempt = await attemptScraping(urlToScrap, scraper);
      text = attempt.text ?? "";
      html = attempt.html ?? "";
      rawHtml = attempt.rawHtml ?? "";
      screenshot = attempt.screenshot ?? "";

      if (attempt.pageStatusCode) {
        pageStatusCode = attempt.pageStatusCode;
      }
      if (attempt.pageError && attempt.pageStatusCode >= 400) {
        pageError = attempt.pageError;
      } else if (attempt && attempt.pageStatusCode && attempt.pageStatusCode < 400) {
        pageError = undefined;
      }

      if (text && text.trim().length >= 100) break;
      if (pageStatusCode && pageStatusCode == 404) break;
      const nextScraperIndex = scrapersInOrder.indexOf(scraper) + 1;
      if (nextScraperIndex < scrapersInOrder.length) {
        console.info(`Falling back to ${scrapersInOrder[nextScraperIndex]}`);
      }
    }

    if (!text) {
      throw new Error(`All scraping methods failed for URL: ${urlToScrap}`);
    }

    const soup = cheerio.load(rawHtml);
    const metadata = extractMetadata(soup, urlToScrap);

    let linksOnPage: string[] | undefined;

    linksOnPage = extractLinks(rawHtml, urlToScrap);

    let document: Document;
    if (screenshot && screenshot.length > 0) {
      document = {
        content: text,
        markdown: text,
        html: pageOptions.includeHtml ? html : undefined,
        rawHtml:
          pageOptions.includeRawHtml ||
            extractorOptions.mode === "llm-extraction-from-raw-html"
            ? rawHtml
            : undefined,
        linksOnPage,
        metadata: {
          ...metadata,
          screenshot: screenshot,
          sourceURL: urlToScrap,
          pageStatusCode: pageStatusCode,
          pageError: pageError,
        },
      };
    } else {
      document = {
        content: text,
        markdown: text,
        html: pageOptions.includeHtml ? html : undefined,
        rawHtml:
          pageOptions.includeRawHtml ||
            extractorOptions.mode === "llm-extraction-from-raw-html"
            ? rawHtml
            : undefined,
        metadata: {
          ...metadata,
          sourceURL: urlToScrap,
          pageStatusCode: pageStatusCode,
          pageError: pageError,
        },
        linksOnPage,
      };
    }

    return document;
  } catch (error) {
    console.error(`Error: ${error} - Failed to fetch URL: ${urlToScrap}`);
    return {
      content: "",
      markdown: "",
      html: "",
      linksOnPage: [],
      metadata: {
        sourceURL: urlToScrap,
        pageStatusCode: pageStatusCode,
        pageError: pageError,
      },
    } as Document;
  }
}
