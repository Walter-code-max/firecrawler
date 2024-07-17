import axios from "axios";
import { FireEngineOptions, FireEngineResponse } from "../../../lib/entities";
import { logScrape } from "../../../services/logging/scrape_log";
import { generateRequestParams } from "../single_url";
import { fetchAndProcessPdf } from "../utils/pdfProcessor";
import { universalTimeout } from "../global";

/**
 * Scrapes a URL with Fire-Engine
 * @param url The URL to scrape
 * @param waitFor The time to wait for the page to load
 * @param screenshot Whether to take a screenshot
 * @param pageOptions The options for the page
 * @param headers The headers to send with the request
 * @param options The options for the request
 * @returns The scraped content
 */
export async function scrapWithFireEngine({
  url,
  waitFor = 0,
  screenshot = false,
  pageOptions = { parsePDF: true },
  fireEngineOptions = {},
  headers,
  options,
}: {
  url: string;
  waitFor?: number;
  screenshot?: boolean;
  pageOptions?: { scrollXPaths?: string[]; parsePDF?: boolean };
  fireEngineOptions?: FireEngineOptions;
  headers?: Record<string, string>;
  options?: any;
  engine?: 'playwright' | 'chrome-cdp' | 'tlsclient';
}): Promise<FireEngineResponse> {
  const logParams = {
    url,
    scraper: "fire-engine",
    success: false,
    response_code: null,
    time_taken_seconds: null,
    error_message: null,
    html: "",
    startTime: Date.now(),
  };

  try {
    const reqParams = await generateRequestParams(url);
    const waitParam = reqParams["params"]?.wait ?? waitFor;
    const screenshotParam = reqParams["params"]?.screenshot ?? screenshot;
    const fireEngineOptionsParam : FireEngineOptions = reqParams["params"]?.fireEngineOptions ?? fireEngineOptions;


    let endpoint = "/scrape";

    if(options?.endpoint === "request") {
      endpoint = "/request";
    }

    let engine = fireEngineOptions?.engine ?? options?.engine ?? "playwright"; // do we want fireEngineOptions as first choice?

    console.log(
      `[Fire-Engine] Scraping ${url} with wait: ${waitParam} and screenshot: ${screenshotParam} and method: ${fireEngineOptionsParam?.method ?? "null"}`
    );

    console.log(fireEngineOptionsParam)

    const response = await axios.post(
      process.env.FIRE_ENGINE_BETA_URL + endpoint,
      {
        url: url,
        wait: waitParam,
        screenshot: screenshotParam,
        headers: headers,
        pageOptions: pageOptions,
        engine: engine,
        ...fireEngineOptionsParam,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: universalTimeout + waitParam,
      }
    );

    if (response.status !== 200) {
      console.error(
        `[Fire-Engine] Error fetching url: ${url} with status: ${response.status}`
      );
      
      logParams.error_message = response.data?.pageError;
      logParams.response_code = response.data?.pageStatusCode;

      if(response.data && response.data?.pageStatusCode !== 200) {
        console.error(`[Fire-Engine] Error fetching url: ${url} with status: ${response.status}`);
      }

      return {
        html: "",
        screenshot: "",
        pageStatusCode: response.data?.pageStatusCode,
        pageError: response.data?.pageError,
      };
    }

    const contentType = response.headers["content-type"];
    if (contentType && contentType.includes("application/pdf")) {
      const { content, pageStatusCode, pageError } = await fetchAndProcessPdf(
        url,
        pageOptions?.parsePDF
      );
      logParams.success = true;
      logParams.response_code = pageStatusCode;
      logParams.error_message = pageError;
      return { html: content, screenshot: "", pageStatusCode, pageError };
    } else {
      const data = response.data;
      logParams.success =
        (data.pageStatusCode >= 200 && data.pageStatusCode < 300) ||
        data.pageStatusCode === 404;
      logParams.html = data.content ?? "";
      logParams.response_code = data.pageStatusCode;
      logParams.error_message = data.pageError;
      return {
        html: data.content ?? "",
        screenshot: data.screenshot ?? "",
        pageStatusCode: data.pageStatusCode,
        pageError: data.pageError,
      };
    }
  } catch (error) {
    if (error.code === "ECONNABORTED") {
      console.log(`[Fire-Engine] Request timed out for ${url}`);
      logParams.error_message = "Request timed out";
    } else {
      console.error(`[Fire-Engine][c] Error fetching url: ${url} -> ${error}`);
      logParams.error_message = error.message || error;
    }
    return { html: "", screenshot: "", pageStatusCode: null, pageError: logParams.error_message };
  } finally {
    const endTime = Date.now();
    logParams.time_taken_seconds = (endTime - logParams.startTime) / 1000;
    await logScrape(logParams, pageOptions);
  }
}


