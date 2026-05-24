/**
 * Historical query support for Dynatrace Dashboard DQL queries.
 *
 * Provides in-memory filtering and pagination for forensic reports and
 * incident timeline entries. These functions support the DQL-based filtering
 * on the Dynatrace Dashboard's incident timeline view (date range, threat
 * classification, namespace, response outcome) and forensic report search.
 *
 * Validates: Requirements 9.9, 9.13, 9.14, 9.15
 */

import { ForensicReport } from "../types/index.js";
import {
  ForensicReportLogPayload,
  IncidentTimelineLogPayload,
} from "../types/dynatrace-ingestion.js";

// --- Interfaces ---

/**
 * Filter for searching forensic reports.
 * Text search is case-insensitive substring match across reportId, podId, namespace.
 */
export interface ReportFilter {
  searchText?: string;
  page: number;
  pageSize?: number; // default 50
}

/**
 * Filter for querying incident timeline entries.
 * Supports date range, threat classification, namespace, and response outcome filters.
 */
export interface IncidentTimelineFilter {
  dateRangeStart?: string; // ISO 8601
  dateRangeEnd?: string; // ISO 8601
  threatClassification?: ("low" | "medium" | "high" | "critical")[];
  namespace?: string;
  responseOutcome?: ("contained" | "escalated" | "false_positive")[];
  page: number;
  pageSize?: number; // max 500
}

/**
 * Paginated result wrapper for query responses.
 */
export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// --- Constants ---

const DEFAULT_REPORT_PAGE_SIZE = 50;
const MAX_INCIDENT_PAGE_SIZE = 500;

// --- Functions ---

/**
 * Searches forensic reports with text filtering and pagination.
 *
 * Converts ForensicReport objects to ForensicReportLogPayload format,
 * applies case-insensitive substring search across reportId, podId, and namespace,
 * then returns a paginated result.
 *
 * @param reports - Array of forensic reports to search
 * @param filter - Search and pagination parameters
 * @returns Paginated result of matching ForensicReportLogPayload entries
 */
export function searchForensicReports(
  reports: ForensicReport[],
  filter: ReportFilter
): PaginatedResult<ForensicReportLogPayload> {
  const pageSize = filter.pageSize ?? DEFAULT_REPORT_PAGE_SIZE;
  const page = Math.max(1, filter.page);

  // Convert reports to log payloads
  const payloads: ForensicReportLogPayload[] = reports.map((report) => ({
    reportId: report.reportId,
    generationTimestamp: report.generationTimestamp,
    threatClassification: report.contextualAssessment.threatClassification,
    affectedPodId: report.accessEventDetails.podId,
    namespace: report.accessEventDetails.namespace,
    reportContent: JSON.stringify(report),
  }));

  // Apply text search filter
  let filtered: ForensicReportLogPayload[];
  if (filter.searchText && filter.searchText.trim().length > 0) {
    const searchLower = filter.searchText.toLowerCase();
    filtered = payloads.filter(
      (payload) =>
        payload.reportId.toLowerCase().includes(searchLower) ||
        payload.affectedPodId.toLowerCase().includes(searchLower) ||
        payload.namespace.toLowerCase().includes(searchLower)
    );
  } else {
    filtered = payloads;
  }

  return paginate(filtered, page, pageSize);
}

/**
 * Queries incident timeline entries with filtering and pagination.
 *
 * Applies date range, threat classification, namespace, and response outcome
 * filters, then returns a paginated result with a maximum of 500 entries per page.
 *
 * @param incidents - Array of incident timeline log payloads to query
 * @param filter - Filter and pagination parameters
 * @returns Paginated result of matching IncidentTimelineLogPayload entries
 */
export function queryIncidentTimeline(
  incidents: IncidentTimelineLogPayload[],
  filter: IncidentTimelineFilter
): PaginatedResult<IncidentTimelineLogPayload> {
  const requestedPageSize = filter.pageSize ?? MAX_INCIDENT_PAGE_SIZE;
  const pageSize = Math.min(requestedPageSize, MAX_INCIDENT_PAGE_SIZE);
  const page = Math.max(1, filter.page);

  let filtered = incidents;

  // Filter by date range start
  if (filter.dateRangeStart) {
    const startTime = new Date(filter.dateRangeStart).getTime();
    filtered = filtered.filter(
      (incident) => new Date(incident.timestamp).getTime() >= startTime
    );
  }

  // Filter by date range end
  if (filter.dateRangeEnd) {
    const endTime = new Date(filter.dateRangeEnd).getTime();
    filtered = filtered.filter(
      (incident) => new Date(incident.timestamp).getTime() <= endTime
    );
  }

  // Filter by threat classification
  if (filter.threatClassification && filter.threatClassification.length > 0) {
    filtered = filtered.filter((incident) =>
      filter.threatClassification!.includes(incident.threatClassification)
    );
  }

  // Filter by namespace
  if (filter.namespace) {
    filtered = filtered.filter(
      (incident) => incident.namespace === filter.namespace
    );
  }

  // Filter by response outcome
  if (filter.responseOutcome && filter.responseOutcome.length > 0) {
    filtered = filtered.filter((incident) =>
      filter.responseOutcome!.includes(incident.finalOutcome)
    );
  }

  return paginate(filtered, page, pageSize);
}

/**
 * Generic pagination helper.
 * Returns a slice of items for the requested page along with pagination metadata.
 */
function paginate<T>(
  items: T[],
  page: number,
  pageSize: number
): PaginatedResult<T> {
  const totalCount = items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageItems = items.slice(startIndex, endIndex);

  return {
    items: pageItems,
    totalCount,
    page,
    pageSize,
    totalPages,
  };
}
