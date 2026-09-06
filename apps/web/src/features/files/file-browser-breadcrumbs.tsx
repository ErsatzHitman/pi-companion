import { Link } from "@tanstack/react-router";

import "./files.css";

export interface FileBrowserBreadcrumbsProps {
  serverId: string;
  agentId: string;
  path: string;
}

interface Crumb {
  key: string;
  label: string;
  path: string;
}

function buildCrumbs(path: string): Crumb[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const crumbs: Crumb[] = [{ key: "root", label: "Files", path: "" }];
  segments.forEach((segment, index) => {
    crumbs.push({
      key: segments.slice(0, index + 1).join("/"),
      label: segment,
      path: segments.slice(0, index + 1).join("/"),
    });
  });
  return crumbs;
}

/**
 * Breadcrumb trail for the current directory (T30B1). A real
 * `nav`/`ol` landmark with the current location marked by
 * `aria-current="page"` rather than styled apart from its siblings
 * (plan.md §10.5).
 */
export function FileBrowserBreadcrumbs({ serverId, agentId, path }: FileBrowserBreadcrumbsProps) {
  const crumbs = buildCrumbs(path);
  return (
    <nav aria-label="Breadcrumb" className="pc-file-browser__breadcrumbs">
      <ol>
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1;
          return (
            <li key={crumb.key}>
              {isCurrent ? (
                <span aria-current="page">{crumb.label}</span>
              ) : (
                <Link
                  className="pc-link"
                  to="/h/$serverId/session/$agentId/files/$"
                  params={{ serverId, agentId, _splat: crumb.path }}
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
