import { parseApi } from "../../src/lib/parseApi";
import { getRateLimiter,  } from "../../src/services/rate-limiter";
import { AuthResponse, RateLimiterMode } from "../../src/types";
import { supabase_service } from "../../src/services/supabase";
import { withAuth } from "../../src/lib/withAuth";
import { RateLimiterRedis } from "rate-limiter-flexible";
import { setTraceAttributes } from '@hyperdx/node-opentelemetry';

export async function authenticateUser(req, res, mode?: RateLimiterMode) : Promise<AuthResponse> {
  return withAuth(supaAuthenticateUser)(req, res, mode);
}
function setTrace(team_id: string, api_key: string) {
  try {
    setTraceAttributes({
      team_id,
      api_key
    });
  } catch (error) {
    console.error('Error setting trace attributes:', error);
  }
  
}
export async function supaAuthenticateUser(
  req,
  res,
  mode?: RateLimiterMode
): Promise<{
  success: boolean;
  team_id?: string;
  error?: string;
  status?: number;
}> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return { success: false, error: "Unauthorized", status: 401 };
  }
  const token = authHeader.split(" ")[1]; // Extract the token from "Bearer <token>"
  if (!token) {
    return {
      success: false,
      error: "Unauthorized: Token missing",
      status: 401,
    };
  }

  const incomingIP = (req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress) as string;
  const iptoken = incomingIP + token;

  let rateLimiter: RateLimiterRedis;
  let subscriptionData: { team_id: string, plan: string } | null = null;
  let normalizedApi: string;

  if (token == "this_is_just_a_preview_token") {
    rateLimiter = getRateLimiter(RateLimiterMode.Preview, token);
  } else {
    normalizedApi = parseApi(token);

    const { data, error } = await supabase_service.rpc(
      'get_key_and_price_id_2', { api_key: normalizedApi }
    );
    // get_key_and_price_id_2 rpc definition:
    // create or replace function get_key_and_price_id_2(api_key uuid)
    //   returns table(key uuid, team_id uuid, price_id text) as $$
    //   begin
    //     if api_key is null then
    //       return query
    //       select null::uuid as key, null::uuid as team_id, null::text as price_id;
    //     end if;

    //     return query
    //     select ak.key, ak.team_id, s.price_id
    //     from api_keys ak
    //     left join subscriptions s on ak.team_id = s.team_id
    //     where ak.key = api_key;
    //   end;
    //   $$ language plpgsql;

    if (error) {
      console.error('Error fetching key and price_id:', error);
    } else {
      // console.log('Key and Price ID:', data);
    }

    if (error || !data || data.length === 0) {
      return {
        success: false,
        error: "Unauthorized: Invalid token",
        status: 401,
      };
    }
    const team_id = data[0].team_id;
    const plan = getPlanByPriceId(data[0].price_id);
    // HyperDX Logging
    setTrace(team_id, normalizedApi);
    subscriptionData = {
      team_id: team_id,
      plan: plan
    }
    switch (mode) { 
      case RateLimiterMode.Crawl:
        rateLimiter = getRateLimiter(RateLimiterMode.Crawl, token, subscriptionData.plan);
        break;
      case RateLimiterMode.Scrape:
        rateLimiter = getRateLimiter(RateLimiterMode.Scrape, token, subscriptionData.plan);
        break;
      case RateLimiterMode.CrawlStatus:
        rateLimiter = getRateLimiter(RateLimiterMode.CrawlStatus, token);
        break;
      case RateLimiterMode.Search:
        rateLimiter = getRateLimiter(RateLimiterMode.Search, token);
        break;
      case RateLimiterMode.Preview:
        rateLimiter = getRateLimiter(RateLimiterMode.Preview, token);
        break;
      default:
        rateLimiter = getRateLimiter(RateLimiterMode.Crawl, token);
        break;
      // case RateLimiterMode.Search:
      //   rateLimiter = await searchRateLimiter(RateLimiterMode.Search, token);
      //   break;
    }
  }

  try {
    await rateLimiter.consume(iptoken);
  } catch (rateLimiterRes) {
    console.error(rateLimiterRes);
    return {
      success: false,
      error: "Rate limit exceeded. Too many requests, try again in 1 minute.",
      status: 429,
    };
  }

  if (
    token === "this_is_just_a_preview_token" &&
    (mode === RateLimiterMode.Scrape || mode === RateLimiterMode.Preview || mode === RateLimiterMode.Search)
  ) {
    return { success: true, team_id: "preview" };
    // check the origin of the request and make sure its from firecrawl.dev
    // const origin = req.headers.origin;
    // if (origin && origin.includes("firecrawl.dev")){
    //   return { success: true, team_id: "preview" };
    // }
    // if(process.env.ENV !== "production") {
    //   return { success: true, team_id: "preview" };
    // }

    // return { success: false, error: "Unauthorized: Invalid token", status: 401 };
  }

  // make sure api key is valid, based on the api_keys table in supabase
  if (!subscriptionData) {
    normalizedApi = parseApi(token);

    const { data, error } = await supabase_service
    .from("api_keys")
    .select("*")
    .eq("key", normalizedApi);

    if (error || !data || data.length === 0) {
      return {
        success: false,
        error: "Unauthorized: Invalid token",
        status: 401,
      };
    }

    subscriptionData = data[0];
  }

  return { success: true, team_id: subscriptionData.team_id };  
}

function getPlanByPriceId(price_id: string) {
  switch (price_id) {
    case process.env.STRIPE_PRICE_ID_STANDARD:
      return 'standard';
    case process.env.STRIPE_PRICE_ID_SCALE:
      return 'scale';
    default:
      return 'starter';
  }
}