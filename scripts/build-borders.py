#!/usr/bin/env python3
"""
Build clean states.geojson and countries.geojson from Natural Earth admin-1 data.

For countries whose admin-1 divisions are at municipality/district level (too fine),
dissolve up to the macro-region level using Natural Earth's `region` field.
For all countries, regenerate the country outline as the union of its sub-regions
so outlines and internal borders share the same geometry (no misalignment artifacts).

Uses topological simplification so shared borders (e.g. US–Canada) are simplified
identically from both sides, eliminating gaps and zigzags.
Also builds land-clipped variants (*-land.geojson) where maritime/lake extents are
removed by intersecting with Natural Earth land polygons.  These are used by the
"Hide maritime borders" toggle so borders only appear over land globally.
"""

import json
import os
import urllib.request
import zipfile
import geopandas as gpd
import pandas as pd
import topojson

SHP       = "/tmp/ne_data/ne_10m_admin_1_states_provinces.shp"
LAND_SHP  = "/tmp/ne_data/ne_10m_land.shp"
LAKES_SHP = "/tmp/ne_data/ne_10m_lakes.shp"
OUT_DIR   = "/Users/davidritsher/Documents/Programming/map-animator/public/data"

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

def ensure_shp(path, url):
    if os.path.exists(path):
        return
    dest = path.replace(".shp", ".zip")
    print(f"Downloading {url}…")
    urllib.request.urlretrieve(url, dest)
    with zipfile.ZipFile(dest) as z:
        z.extractall("/tmp/ne_data")
    print("  Done.")

def load_land(simplify_tol):
    ensure_shp(LAND_SHP,  "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip")
    ensure_shp(LAKES_SHP, "https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip")

    print(f"Building land-minus-lakes polygon (simplify={simplify_tol})…")
    land  = gpd.read_file(LAND_SHP).to_crs("EPSG:4326")
    lakes = gpd.read_file(LAKES_SHP).to_crs("EPSG:4326")

    land_union  = land.geometry.union_all()
    # Only subtract large lakes (scalerank <= 2): Great Lakes, Lake Victoria, Baikal,
    # Lake Winnipeg, Lake of the Woods, etc.  Excludes smaller reservoirs and lakes
    # that form state/province borders (Lake Oahe, Kentucky Lake, etc.) which would
    # make internal borders disappear.
    major_lakes = lakes[lakes["scalerank"] <= 2]
    lakes_union = major_lakes.geometry.union_all()

    # Subtract major inland water bodies from land.
    # ne_10m_land treats inland waters as land, so we remove them explicitly.
    land_no_lakes = land_union.difference(lakes_union)

    # Small buffer absorbs floating-point gaps between the land and admin-1 polygons
    # so thin coastal strips don't get accidentally clipped.
    land_no_lakes = land_no_lakes.buffer(0.001)

    # Pre-simplify at the same tolerance as the state polygons so the intersection
    # result stays at a consistent vertex density.
    land_no_lakes = land_no_lakes.simplify(simplify_tol, preserve_topology=True)
    return land_no_lakes

def load_ne():
    print("Loading Natural Earth admin-1 shapefile…")
    gdf = gpd.read_file(SHP)
    gdf = gdf[["name", "admin", "region", "geometry"]].copy()
    gdf = gdf.to_crs("EPSG:4326")
    return gdf

def drop_small_parts(gdf, min_area_km2=5.0):
    """
    Remove tiny polygon parts (e.g. lake islands in Quebec) that clutter border display.
    Uses an equal-area projection so the threshold is consistent globally.
    Whole-polygon features smaller than the threshold are retained as-is so small
    island nations (Maldives, Nauru, etc.) aren't accidentally removed.
    """
    import shapely
    min_area_m2 = min_area_km2 * 1e6
    gdf_ea = gdf.to_crs("EPSG:6933")

    def filter_parts(geom_wgs84, geom_ea):
        if geom_wgs84 is None or geom_wgs84.is_empty:
            return geom_wgs84
        if geom_ea.geom_type != "MultiPolygon":
            return geom_wgs84   # single polygon — keep regardless of size
        kept = [pw for pw, pe in zip(geom_wgs84.geoms, geom_ea.geoms)
                if pe.area >= min_area_m2]
        if not kept:
            return geom_wgs84   # nothing passed — keep largest part
        return shapely.multipolygons(kept) if len(kept) > 1 else kept[0]

    result = gdf.copy()
    result["geometry"] = [filter_parts(w, e)
                          for w, e in zip(gdf.geometry, gdf_ea.geometry)]
    result["geometry"] = result["geometry"].buffer(0)
    return gpd.GeoDataFrame(result, geometry="geometry", crs="EPSG:4326")

def clip_to_land(states, land_union):
    """
    Intersect state/country polygons with a pre-simplified land union.
    The land_union should already be simplified at the same tolerance as the states
    so the intersection result stays at a consistent vertex density.
    After clipping, tiny lake-island polygon parts are removed.
    """
    print("  Clipping to land…")
    clipped = states.copy()
    clipped["geometry"] = clipped["geometry"].intersection(land_union)
    clipped["geometry"] = clipped["geometry"].buffer(0)
    clipped = clipped[~clipped.geometry.is_empty & clipped.geometry.notna()]
    print("  Dropping small island parts…")
    clipped = drop_small_parts(clipped, min_area_km2=5.0)
    return gpd.GeoDataFrame(clipped, geometry="geometry", crs="EPSG:4326")

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
    gdf    = load_ne()
    states = build_states(gdf)
    land_full = load_land(simplify_tol=0.003)
    land_mob  = load_land(simplify_tol=0.02)

    print(f"\nSub-region count: {len(states)}")
    print("Sub-regions per country (top 20):")
    counts = states.groupby("admin").size().sort_values(ascending=False)
    for country, n in counts.head(20).items():
        marker = " *dissolved" if country in DISSOLVE_TO_REGION else ""
        print(f"  {n:4d}  {country}{marker}")

    # Full resolution: topo-simplify provinces together so shared edges match,
    # then dissolve countries from the same simplified geometry.
    # Use 0.003° (~300m) to preserve Great Lakes / complex coastline detail.
    print("\nBuilding full-resolution dataset…")
    states_full   = topo_simplify(states[["name","admin","geometry"]], 0.003)
    countries_full = build_countries(states_full)

    print("\nBuilding full-resolution land-clipped dataset…")
    states_full_land   = clip_to_land(states_full, land_full)
    countries_full_land = build_countries(states_full_land)

    # Mobile: coarser simplification
    print("\nBuilding mobile dataset…")
    states_mob   = topo_simplify(states[["name","admin","geometry"]], 0.02)
    countries_mob = build_countries(states_mob)

    print("\nBuilding mobile land-clipped dataset…")
    states_mob_land   = clip_to_land(states_mob, land_mob)
    countries_mob_land = build_countries(states_mob_land)

    print("\nWriting full-resolution files…")
    to_geojson(states_full,                               f"{OUT_DIR}/states.geojson")
    to_geojson(countries_full[["admin","NAME","geometry"]], f"{OUT_DIR}/countries.geojson")
    to_geojson(states_full_land,                               f"{OUT_DIR}/states-land.geojson")
    to_geojson(countries_full_land[["admin","NAME","geometry"]], f"{OUT_DIR}/countries-land.geojson")

    print("\nWriting mobile files…")
    to_geojson(states_mob,                                f"{OUT_DIR}/states-mobile.geojson")
    to_geojson(countries_mob[["admin","NAME","geometry"]], f"{OUT_DIR}/countries-mobile.geojson")
    to_geojson(states_mob_land,                                f"{OUT_DIR}/states-mobile-land.geojson")
    to_geojson(countries_mob_land[["admin","NAME","geometry"]], f"{OUT_DIR}/countries-mobile-land.geojson")

    print("\nDone.")

if __name__ == "__main__":
    main()
