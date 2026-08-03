export function PageScaffold({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="page-scaffold">
      <header>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </header>
      <div className="empty-surface">
        <p>
          Production data will appear here as this Milestone A capability is
          enabled.
        </p>
      </div>
    </section>
  );
}
