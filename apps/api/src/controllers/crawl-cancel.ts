import { Request, Response } from "express";
import { authenticateUser } from "./auth";
import { RateLimiterMode } from "../../src/types";
import { addWebScraperJob } from "../../src/services/queue-jobs";
import { getWebScraperQueue } from "../../src/services/queue-service";
import { supabase_service } from "../../src/services/supabase";
import { billTeam } from "../../src/services/billing/credit_billing";

export async function crawlCancelController(req: Request, res: Response) {
  try {
    const { success, team_id, error, status } = await authenticateUser(
      req,
      res,
      RateLimiterMode.CrawlStatus
    );
    if (!success) {
      return res.status(status).json({ error });
    }
    const job = await getWebScraperQueue().getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // check if the job belongs to the team
    const { data, error: supaError } = await supabase_service
      .from("bulljobs_teams")
      .select("*")
      .eq("job_id", req.params.jobId)
      .eq("team_id", team_id);
    if (supaError) {
      return res.status(500).json({ error: supaError.message });
    }

    if (data.length === 0) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const jobState = await job.getState();
    const { partialDocs } = await job.progress();

    if (partialDocs && partialDocs.length > 0 && jobState === "active") {
      console.log("Billing team for partial docs...");
      // Note: the credits that we will bill them here might be lower than the actual
      // due to promises that are not yet resolved
      await billTeam(team_id, partialDocs.length);
    }

    try {
      await job.moveToFailed(Error("Job cancelled by user"), true);
    } catch (error) {
      console.error(error);
    }

    const newJobState = await job.getState();

    res.json({
      status: newJobState === "failed" ? "cancelled" : "Cancelling...",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
