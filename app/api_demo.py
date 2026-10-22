"""Plug-in endpoint example: GET /api/x/demo/count/all → number of geolocated buses. Pattern for api_<module>.py files:
ROUTES = {name: fn(conn, key)} where key is 'all', 'hub' or a bus id (str); return a JSON-able dict, or None for 404."""
import busdata

ROUTES = {'count': lambda c, key: {'buses': busdata.rows(c, 'SELECT count(*) AS n FROM dim_bus WHERE latitude IS NOT NULL')[0]['n']}}
