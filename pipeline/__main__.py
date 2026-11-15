"""CLI entrypoint for the Agnidrishti FIRMS pipeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import availability, backcast, boundaries, community, config, download, experiments, historical, manifests, points, pre2012, process, provenance, validation


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
    p_area.add_argument("--region-id", default=None, help="Store under a study-region directory")
    p_area.add_argument("--force", action="store_true")
    p_area.add_argument("--sensors", nargs="*", default=None)

    p_hist = sub.add_parser("download-historical", help="Download historical SP data (Jan-Jun + Jul)")
    p_hist.add_argument("--regions", nargs="*", default=None, help="Region ids (default: all six)")
    p_hist.add_argument("--force", action="store_true")
    p_hist.add_argument("--sensors", nargs="*", default=None)

    p_pre = sub.add_parser(
        "download-pre2012",
        help="Resumable pre-2012 MODIS acquisition (2000-11-01..2011-12-31)",
    )
    p_pre.add_argument("--start", default=pre2012.PRE2012_START)
    p_pre.add_argument("--end", default=pre2012.PRE2012_END)
    p_pre.add_argument("--regions", nargs="*", default=None)
    p_pre.add_argument("--workers", type=int, default=pre2012.DEFAULT_WORKERS)
    p_pre.add_argument("--force", action="store_true")
    p_pre.add_argument("--dry-run", action="store_true")

    p_hist_inv = sub.add_parser(
        "historical-inventory", help="Task 04B Phase 1: inventory of historical SP chunks"
    )

    p_hist_an = sub.add_parser(
        "historical-analysis",
        help="Task 04B: inventory, quality, overlap, comparability, coverage, readiness",
    )

    p_exp = sub.add_parser(
        "experiments",
        help="Task 05: harmonization experiments, Method Court, Seam Audit, Lights-Out",
    )
    p_exp.add_argument(
        "--from-pairs",
        type=Path,
        default=None,
        help="Run from a committed pair table CSV instead of raw FIRMS data",
    )

    sub.add_parser(
        "community-update",
        help="Fetch weather, compute fire danger, rebuild community intelligence exports",
    )

    sub.add_parser(
        "validate",
        help="Task 06: independent audit, sensitivity, robustness, reliability",
    )

    sub.add_parser(
        "backcast",
        help="Test temporal transferability and decide pre-2012 VIIRS-equivalent support",
    )

    sub.add_parser(
        "export-historical-estimates",
        help="Write separate pre-2012 MODIS-derived estimates (raw MODIS preserved)",
    )

    sub.add_parser(
        "export-data-manifest",
        help="Build the machine-readable provenance/coverage/harmonization manifest",
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
        if args.archive is not None:
            if not args.archive.exists():
                raise SystemExit(f"Archive not found: {args.archive}")
            boundaries.ensure_study_areas(archive_path=args.archive)
            info = {"status": "built", "regions": list(config.REGION_ORDER)}
        else:
            info = boundaries.build_study_areas()
        print(json.dumps(info, indent=2, default=str))
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
            region_id=args.region_id,
        )
        print(result["retrieved_at"])
        for entry in result["entries"]:
            print(f"{entry['sensor_id']} {entry.get('date_window')}: {entry.get('status')} rows={entry.get('global_rows')}")
    elif args.command == "download-historical":
        result = download.download_historical(
            sensors=args.sensors,
            regions=args.regions,
            force=args.force,
        )
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "download-pre2012":
        result = pre2012.download_pre2012(
            start=args.start,
            end=args.end,
            regions=args.regions,
            workers=args.workers,
            force=args.force,
            dry_run=args.dry_run,
        )
        print(json.dumps(result, indent=2, default=str))

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
        result = experiments.run_experiments(from_pairs=args.from_pairs)
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "validate":
        result = validation.run_validation()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "backcast":
        result = backcast.run_transferability()
        print(json.dumps({
            "generated_at": result["generated_at"],
            "calibration_version": result["calibration_version"],
            "court_verdict": result["court_verdict"],
            "decisions": {
                region: {platform: info["decision"] for platform, info in platforms.items()}
                for region, platforms in result["regions"].items()
            },
        }, indent=2))

    elif args.command == "export-historical-estimates":
        result = backcast.export_historical_estimates()
        print(json.dumps(result, indent=2))

    elif args.command == "export-data-manifest":
        result = provenance.export_data_manifest()
        print(json.dumps(result, indent=2))

    elif args.command == "export-frontend":
        result = experiments.export_frontend_artifacts()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "export-points":
        result = points.run_point_export()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "community-update":
        result = community.run_community_update()
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
