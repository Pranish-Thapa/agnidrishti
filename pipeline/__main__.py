"""CLI entrypoint for the Agnidrishti FIRMS pipeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import availability, boundaries, config, download, experiments, historical, manifests, points, process, validation


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    p_avail = sub.add_parser("availability", help="Query FIRMS data availability")
    p_avail.add_argument("--map-key", default=None)

    p_bound = sub.add_parser("boundaries", help="Build study-area boundaries")
    p_bound.add_argument("--archive", type=Path, default=None)
    p_bound.add_argument("--download", action="store_true")

    p_nrt = sub.add_parser("download-nrt", help="Download public 7-day NRT snapshots")
    p_nrt.add_argument("--force", action="store_true")
    p_nrt.add_argument("--sensors", nargs="*", default=None)

    p_area = sub.add_parser("download-area", help="Download Area API chunks (requires MAP_KEY)")
    p_area.add_argument("--start", required=True)
    p_area.add_argument("--end", required=True)
    p_area.add_argument("--bbox", required=True)
    p_area.add_argument("--force", action="store_true")
    p_area.add_argument("--sensors", nargs="*", default=None)

    p_hist = sub.add_parser("download-historical", help="Download historical SP data (Jan-Jun + Jul)")
    p_hist.add_argument("--bbox", default="80,27,86,29.5")
    p_hist.add_argument("--force", action="store_true")
    p_hist.add_argument("--sensors", nargs="*", default=None)

    p_hist_inv = sub.add_parser(
        "historical-inventory", help="Task 04B Phase 1: inventory of historical SP chunks"
    )

    p_hist_an = sub.add_parser(
        "historical-analysis",
        help="Task 04B: inventory, quality, overlap, comparability, coverage, readiness",
    )

    sub.add_parser(
        "experiments",
        help="Task 05: harmonization experiments, Method Court, Seam Audit, Lights-Out",
    )

    sub.add_parser(
        "validate",
        help="Task 06: independent audit, sensitivity, robustness, reliability",
    )

    sub.add_parser(
        "export-frontend",
        help="Export harmonization factors for the frontend calendar",
    )

    sub.add_parser(
        "export-points",
        help="Export verified point-level hotspot detections for the map",
    )

    p_proc = sub.add_parser("process", help="Process downloaded raw data")
    p_proc.add_argument("--provider", choices=["nrt", "area-api"], default="nrt")
    p_proc.add_argument("--boundaries", type=Path, default=None)
    p_proc.add_argument("--no-public", action="store_true")

    args = parser.parse_args()
    config.ensure_directories()

    if args.command == "availability":
        key = args.map_key or config.map_key()
        report = availability.run_availability(map_key=key)
        print(f"Availability status: {report['status']}")
    elif args.command == "boundaries":
        if args.download:
            boundaries.download_source_archive()
        archive = args.archive
        if archive is None:
            archive = config.BOUNDARY_SOURCE_DIR / "npl_admin_boundaries.geojson.zip"
        if not archive.exists():
            raise SystemExit(f"Archive not found: {archive}")
        info = boundaries.build_study_areas(archive_path=archive)
        print(info)
    elif args.command == "download-nrt":
        result = download.download_nrt(sensors=args.sensors, force=args.force)
        print(result["retrieved_at"])
        for entry in result["entries"]:
            print(f"{entry['sensor_id']}: {entry.get('status')} rows={entry.get('global_rows')}")
    elif args.command == "download-area":
        result = download.download_area_api(
            start=args.start,
            end=args.end,
            bbox=args.bbox,
            sensors=args.sensors,
            force=args.force,
        )
        print(result["retrieved_at"])
        for entry in result["entries"]:
            print(f"{entry['sensor_id']} {entry.get('date_window')}: {entry.get('status')} rows={entry.get('global_rows')}")
    elif args.command == "download-historical":
        result = download.download_historical(
            sensors=args.sensors,
            bbox=args.bbox,
            force=args.force,
        )
        print(f"entries: {len(result['entries'])}")

    elif args.command == "historical-inventory":
        report = historical.build_inventory()
        target = historical.HISTORICAL_DIR / "inventory.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        manifests.write_json(target, report)
        print(f"inventory written to {target}")

    elif args.command == "historical-analysis":
        result = historical.run_historical_analysis()
        print(f"records: {result['record_count']}")
        for path in result["outputs"]:
            print(f"  {path}")

    elif args.command == "experiments":
        result = experiments.run_experiments()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "validate":
        result = validation.run_validation()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "export-frontend":
        result = experiments.export_frontend_artifacts()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "export-points":
        result = points.run_point_export()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "process":
        result = process.run_processing(
            provider=args.provider,
            boundaries_path=args.boundaries,
            into_public=not args.no_public,
        )
        print(result)


if __name__ == "__main__":
    main()
