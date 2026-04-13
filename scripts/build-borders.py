#!/usr/bin/env python3
"""
Build clean states.geojson and countries.geojson from Natural Earth admin-1 data.

For countries whose admin-1 divisions are at municipality/district level (too fine),
dissolve up to the macro-region level using Natural Earth's `region` field.
For all countries, regenerate the country outline as the union of its sub-regions
so outlines and internal borders share the same geometry (no misalignment artifacts).

Uses topological simplification so shared borders (e.g. US–Canada) are simplified
identically from both sides, eliminating gaps and zigzags.
"""

import json
import os
import geopandas as gpd
import pandas as pd
import topojson

SHP = "/tmp/ne_data/ne_10m_admin_1_states_provinces.shp"
OUT_DIR = "/Users/davidritsher/Documents/Programming/map-animator/public/data"

# Countries where admin-1 is too fine (municipalities/districts).
# Dissolve these up to the `region` field (NUTS1 / macro-region level).
DISSOLVE_TO_REGION = {
    "France",           # 101 departments → 18 regions
    "Italy",            # 110 provinces   → 20 regions
    "United Kingdom",   # 232 districts   → 16 NUTS1 regions
    "Slovenia",         # 193 municipalities → 8 statistical regions
    "Latvia",           # 119 parishes    → 5 planning regions
    "Macedonia",        # 84 municipalities → 8 planning regions
    "Azerbaijan",       # 78 districts    → 10 economic regions
    "Hungary",          # 43 counties     → 7 NUTS1 regions
    "Spain",            # 52 provinces    → 19 autonomous communities
}

def load_ne():
    print("Loading Natural Earth admin-1 shapefile…")
    gdf = gpd.read_file(SHP)
    gdf = gdf[["name", "admin", "region", "geometry"]].copy()
    gdf = gdf.to_crs("EPSG:4326")
    return gdf

def build_states(gdf):
    print("Building sub-regions…")
    parts = []

    for country, group in gdf.groupby("admin"):
        if country in DISSOLVE_TO_REGION:
            has_region = group["region"].notna() & (group["region"].str.strip() != "")
            if has_region.any():
                dissolved = (
                    group[has_region]
                    .dissolve(by="region", as_index=False)
                    [["region", "admin", "geometry"]]
                    .rename(columns={"region": "name"})
                )
                if not has_region.all():
                    remainder = group[~has_region].dissolve(as_index=False)
                    remainder = remainder[["admin", "geometry"]].copy()
                    remainder["name"] = f"{country} (other)"
                    dissolved = pd.concat([dissolved, remainder[["name","admin","geometry"]]], ignore_index=True)
                parts.append(dissolved)
            else:
                parts.append(group[["name", "admin", "geometry"]])
        else:
            parts.append(group[["name", "admin", "geometry"]])

    states = pd.concat(parts, ignore_index=True)
    states = gpd.GeoDataFrame(states, geometry="geometry", crs="EPSG:4326")
    states["geometry"] = states["geometry"].buffer(0)
    return states

def build_countries(states):
    print("  Dissolving sub-regions to country outlines…")
    countries = states.dissolve(by="admin", as_index=False)[["admin", "geometry"]]
    countries["NAME"] = countries["admin"]
    countries["geometry"] = countries["geometry"].buffer(0)
    return countries

def topo_simplify(states, tolerance):
    """
    Topologically simplify the full province dataset so shared borders
    (e.g. BC/Montana, Ontario/Minnesota) are simplified identically from both sides.
    Returns a GeoDataFrame with the same rows in the same order.
    """
    print(f"  Topologically simplifying at tolerance={tolerance}…")
    topo = topojson.Topology(states, prequantize=False)
    result = topo.toposimplify(tolerance).to_gdf()
    # toposimplify may reorder rows — restore original index order by admin+name
    result = result.set_index(["admin", "name"]).reindex(
        states.set_index(["admin", "name"]).index
    ).reset_index()
    result = gpd.GeoDataFrame(result, geometry="geometry", crs="EPSG:4326")
    result["geometry"] = result["geometry"].buffer(0)
    return result

def round_coords(obj, precision=5):
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, precision) for v in obj]
        return [round_coords(item, precision) for item in obj]
    return obj

def to_geojson(gdf, path, precision=5):
    print(f"  Writing {path}  ({len(gdf)} features)")
    gdf.to_file(path, driver="GeoJSON")
    with open(path) as f:
        data = json.load(f)
    for feature in data["features"]:
        if feature.get("geometry"):
            feature["geometry"]["coordinates"] = round_coords(
                feature["geometry"]["coordinates"], precision
            )
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"    {os.path.getsize(path)/1024/1024:.1f} MB")

def main():
    gdf = load_ne()
    states = build_states(gdf)

    print(f"\nSub-region count: {len(states)}")
    print("Sub-regions per country (top 20):")
    counts = states.groupby("admin").size().sort_values(ascending=False)
    for country, n in counts.head(20).items():
        marker = " *dissolved" if country in DISSOLVE_TO_REGION else ""
        print(f"  {n:4d}  {country}{marker}")

    # Full resolution: topo-simplify provinces together so shared edges match,
    # then dissolve countries from the same simplified geometry.
    print("\nBuilding full-resolution dataset…")
    states_full = topo_simplify(states[["name","admin","geometry"]], 0.01)
    countries_full = build_countries(states_full)

    # Mobile: coarser topo-simplification
    print("\nBuilding mobile dataset…")
    states_mob = topo_simplify(states[["name","admin","geometry"]], 0.05)
    countries_mob = build_countries(states_mob)

    print("\nWriting full-resolution files…")
    to_geojson(states_full,                          f"{OUT_DIR}/states.geojson")
    to_geojson(countries_full[["admin","NAME","geometry"]], f"{OUT_DIR}/countries.geojson")

    print("\nWriting mobile files…")
    to_geojson(states_mob,                           f"{OUT_DIR}/states-mobile.geojson")
    to_geojson(countries_mob[["admin","NAME","geometry"]], f"{OUT_DIR}/countries-mobile.geojson")

    print("\nDone.")

if __name__ == "__main__":
    main()
