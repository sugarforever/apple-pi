import React from "react";
import { Search } from "lucide-react";

export function SectionHeading(props: { id: string; title: React.ReactNode; description: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <h2 id={props.id}>{props.title}</h2>
        <p>{props.description}</p>
      </div>
      {props.actions && <div className="section-heading-actions">{props.actions}</div>}
    </div>
  );
}

export function SearchField(props: { label: string; placeholder: string; value: string; onChange(value: string): void }) {
  return (
    <label className="search-field">
      <span className="sr-only">{props.label}</span>
      <Search size={15} aria-hidden="true" />
      <input type="search" value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} />
    </label>
  );
}

export function StatusBadge(props: { className?: string; tone?: "neutral" | "success" | "danger"; children: React.ReactNode }) {
  return <span className={`status-badge ${props.tone ?? "neutral"} ${props.className ?? ""}`.trim()}>{props.children}</span>;
}

export function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", type = "button", ...buttonProps } = props;
  return <button type={type} className={`icon-button ${className}`.trim()} {...buttonProps} />;
}

export function Notice(props: { className?: string; role?: "alert" | "status"; children: React.ReactNode }) {
  return (
    <div className={`compact-notice ${props.className ?? ""}`.trim()} role={props.role}>
      {props.children}
    </div>
  );
}
