#!/usr/bin/env python3
"""Emails a summary of projects going live in the next 60 days.

Reads dashboard/data/projects.json (refreshed beforehand by the caller),
filters to go_live dates within the next N days, and sends an HTML email
via O365 SMTP AUTH.
"""

import argparse
import json
import os
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_FILE = SCRIPT_DIR / "dashboard" / "data" / "projects.json"


def load_projects(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("projects", data) if isinstance(data, dict) else data


def parse_go_live(value):
    if not value:
        return None
    value = str(value).strip()
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def upcoming_go_lives(projects, window_days):
    today = datetime.now(timezone.utc).date()
    cutoff = today + timedelta(days=window_days)
    results = []
    for p in projects:
        go_live = parse_go_live(p.get("go_live"))
        if go_live and today <= go_live <= cutoff:
            results.append((go_live, p))
    results.sort(key=lambda item: item[0])
    return results, today, cutoff


def build_email_body(results, today, cutoff, window_days):
    if not results:
        html_rows = "<tr><td colspan='4' style='padding:12px;color:#666;'>No go-lives scheduled in this window.</td></tr>"
        text_rows = "No go-lives scheduled in this window.\n"
    else:
        html_rows = ""
        text_rows = ""
        for go_live, p in results:
            title = p.get("title", "Unknown")
            pm = p.get("project_manager", "") or ""
            im = p.get("implementation_manager", "") or ""
            url = p.get("url", "")
            days_out = (go_live - today).days
            html_rows += (
                "<tr>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;'>{go_live.isoformat()}</td>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;'><a href='{url}'>{title}</a></td>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;'>{pm}</td>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;'>{im}</td>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;'>{days_out}</td>"
                "</tr>"
            )
            text_rows += f"{go_live.isoformat()}  ({days_out:>3}d)  {title}  PM: {pm}  IM: {im}\n"

    html = f"""
    <html><body style="font-family:Arial,sans-serif;">
    <h2>Go-Lives: Next {window_days} Days</h2>
    <p>{today.isoformat()} through {cutoff.isoformat()} &middot; {len(results)} project(s)</p>
    <table style="border-collapse:collapse;width:100%;">
      <thead>
        <tr style="text-align:left;background:#f5f5f5;">
          <th style="padding:8px;">Go-Live</th>
          <th style="padding:8px;">Project</th>
          <th style="padding:8px;">Project Manager</th>
          <th style="padding:8px;">Implementation Manager</th>
          <th style="padding:8px;">Days Out</th>
        </tr>
      </thead>
      <tbody>
        {html_rows}
      </tbody>
    </table>
    </body></html>
    """

    text = f"Go-Lives: Next {window_days} Days\n{today.isoformat()} through {cutoff.isoformat()} - {len(results)} project(s)\n\n{text_rows}"
    return text, html


def send_email(subject, text_body, html_body, recipients, smtp_host, smtp_port, smtp_user, smtp_password):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.sendmail(smtp_user, recipients, msg.as_string())


def main():
    parser = argparse.ArgumentParser(description="Email upcoming go-lives")
    parser.add_argument("--data-file", default=str(DEFAULT_DATA_FILE))
    parser.add_argument("--window-days", type=int, default=60)
    parser.add_argument("--to", default=os.getenv("GO_LIVE_EMAIL_TO", ""))
    parser.add_argument("--smtp-host", default=os.getenv("SMTP_HOST", "smtp.office365.com"))
    parser.add_argument("--smtp-port", type=int, default=int(os.getenv("SMTP_PORT", "587")))
    parser.add_argument("--smtp-user", default=os.getenv("SMTP_USER", ""))
    parser.add_argument("--smtp-password", default=os.getenv("SMTP_PASSWORD", ""))
    parser.add_argument("--dry-run", action="store_true", help="Print the email instead of sending it")
    args = parser.parse_args()

    if not args.to:
        sys.exit("Missing recipient(s). Set GO_LIVE_EMAIL_TO or pass --to.")
    if not args.dry_run and (not args.smtp_user or not args.smtp_password):
        sys.exit("Missing SMTP credentials. Set SMTP_USER and SMTP_PASSWORD (or pass --smtp-user/--smtp-password).")

    projects = load_projects(Path(args.data_file))
    results, today, cutoff = upcoming_go_lives(projects, args.window_days)
    text_body, html_body = build_email_body(results, today, cutoff, args.window_days)
    subject = f"Go-Lives: Next {args.window_days} Days ({len(results)} project{'s' if len(results) != 1 else ''})"
    recipients = [addr.strip() for addr in args.to.split(",") if addr.strip()]

    if args.dry_run:
        print(f"Subject: {subject}")
        print(f"To: {', '.join(recipients)}")
        print()
        print(text_body)
        return

    send_email(subject, text_body, html_body, recipients, args.smtp_host, args.smtp_port, args.smtp_user, args.smtp_password)
    print(f"Sent go-live email to {', '.join(recipients)} ({len(results)} project(s) in window).")


if __name__ == "__main__":
    main()
