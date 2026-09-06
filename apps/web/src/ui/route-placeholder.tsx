/**
 * Placeholder body for a route stub (T15). Later tasks replace each of
 * these with real screens; this only proves the route resolves and shows
 * its params, which the shell needs before deep links can be trusted.
 */
export function RoutePlaceholder({
  title,
  params,
}: {
  title: string;
  params?: Record<string, string>;
}) {
  return (
    <section className="route-placeholder">
      {/*
        T54A2: level two, not one. `Shell` renders the single per-route
        `<h1>`; this stub sits inside that shell, so an `<h1>` here would
        give the route two and fail axe's heading rules.
      */}
      <h2>{title}</h2>
      {params && Object.keys(params).length > 0 ? (
        <dl className="route-placeholder__params">
          {Object.entries(params).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
