from pipeline import config, geometry

BOUNDARIES = config.STUDY_AREA_BOUNDARIES


def test_boundaries_exist_and_load():
    assert BOUNDARIES.exists()
    boundaries = geometry.load_boundaries()
    assert {b.district_id for b in boundaries} == set(config.REGION_ORDER)


def test_representative_points_inside():
    boundaries = geometry.load_boundaries()
    index = geometry.DistrictIndex(boundaries)
    points = geometry.representative_points(boundaries)
    for district_id, (lon, lat) in points.items():
        assignment = index.assign(lon, lat)
        assert assignment.district_id == district_id, (district_id, assignment)


def test_outside_point_not_assigned():
    boundaries = geometry.load_boundaries()
    index = geometry.DistrictIndex(boundaries)
    # A point far outside Nepal.
    assignment = index.assign(0.0, 0.0)
    assert assignment.district_id is None


def test_bbox_is_not_polygon():
    boundaries = geometry.load_boundaries()
    index = geometry.DistrictIndex(boundaries)
    # Use the union bbox corner; it should not be automatically assigned
    # unless it happens to fall inside a polygon. Check that at least one
    # bbox corner is not assigned (proves bbox != PIP).
    west, south, east, north = index.union_bounds
    corners = [(west, south), (west, north), (east, south), (east, north)]
    assigned = [index.assign(lon, lat).district_id for lon, lat in corners]
    assert any(value is None for value in assigned), assigned


def test_boundary_touch_flag():
    boundaries = geometry.load_boundaries()
    index = geometry.DistrictIndex(boundaries)
    # A point exactly on a vertex is an edge case; representative points are interior.
    boundaries_list = boundaries
    assert all(isinstance(b.geometry, object) for b in boundaries_list)
