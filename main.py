import os
import json
import requests
from dotenv import load_dotenv
from collections import defaultdict
import time

load_dotenv()

API_KEY = os.getenv("OPENALEX_API_KEY")
if not API_KEY:
    print("Error: OPENALEX_API_KEY not found in environment variables or .env file.")
    print("Please create a .env file with OPENALEX_API_KEY=your_key and run again.")
    exit(1)

# UVic ROR ID
UVIC_ROR = "https://ror.org/04s5mat29"
CANADA_CODE = "CA"

# Define headers with API Key (OpenAlex supports API keys as Bearer tokens)
headers = {
    "Authorization": f"Bearer {API_KEY}"
}

def fetch_uvic_collaborations():
    print("Fetching UVic works from OpenAlex API (2024-2025)...")
    
    collaborations = defaultdict(lambda: {"count": 0, "name": "", "lat": 0, "lon": 0})
    
    # We will need the coordinates of institutions. We can cache them.
    institution_cache = {}
    
    url = "https://api.openalex.org/works"
    params = {
        "filter": f"institutions.ror:{UVIC_ROR},publication_year:2024|2025",
        "per-page": 100,
        "cursor": "*"
        # Note: can also pass api_key as param if Bearer token doesn't work: "api_key": API_KEY
    }
    
    works_count = 0
    
    while True:
        try:
            response = requests.get(url, params=params, headers=headers)
            if response.status_code != 200:
                print(f"Error fetching works: {response.status_code} - {response.text}")
                # Fallback to appending api_key if Bearer fails
                if response.status_code == 403 or response.status_code == 401:
                    print("Retrying with api_key query parameter instead of Authorization header...")
                    params["api_key"] = API_KEY
                    headers.pop("Authorization", None)
                    response = requests.get(url, params=params, headers=headers)
                    if response.status_code != 200:
                        break
                else:
                    break
                
            data = response.json()
            results = data.get("results", [])
            
            if not results:
                break
                
            works_count += len(results)
            print(f"Fetched {works_count} works...")
            
            for work in results:
                authorships = work.get("authorships", [])
                for auth in authorships:
                    institutions = auth.get("institutions", [])
                    for inst in institutions:
                        # Check if institution is outside Canada
                        country_code = inst.get("country_code")
                        # The original code had: `if country_code and country_code != CANADA_CODE:`
                        # This was removed to include domestic institutions as well.
                        
                        inst_id = inst.get("id")
                        if inst_id:
                            if inst_id not in institution_cache:
                                institution_cache[inst_id] = {
                                    "name": inst.get("display_name", "Unknown Institution"),
                                    "country_code": country_code,
                                    "lat": None,
                                    "lon": None
                                }
                            
                            collaborations[inst_id]["count"] += 1
                            collaborations[inst_id]["name"] = institution_cache[inst_id]["name"]
                            collaborations[inst_id]["id"] = inst_id # Save the OpenAlex URL format ID
                                
            cursor = data.get("meta", {}).get("next_cursor")
            if not cursor:
                break
                
            params["cursor"] = cursor
            
            # Rate limiting delay
            time.sleep(0.1)
            
        except Exception as e:
            print(f"Exception during works fetch: {e}")
            break
            
    print(f"Finished fetching {works_count} works. Processing {len(collaborations)} collaborating international institutions.")
    
    # Fetch coordinates for institutions that need it
    print("Fetching coordinates for institutions...")
    inst_ids = list(collaborations.keys())
    chunk_size = 50
    
    for i in range(0, len(inst_ids), chunk_size):
        chunk = inst_ids[i:i+chunk_size]
        inst_filter = "openalex:" + "|".join(chunk)
        
        inst_url = "https://api.openalex.org/institutions"
        inst_params = {
            "filter": inst_filter,
            "per-page": chunk_size
        }
        if "api_key" in params:
            inst_params["api_key"] = API_KEY
        
        try:
            res = requests.get(inst_url, params=inst_params, headers=headers)
            if res.status_code == 200:
                inst_data = res.json().get("results", [])
                for inst_obj in inst_data:
                    geo = inst_obj.get("geo", {})
                    lat = geo.get("latitude")
                    lon = geo.get("longitude")
                    oid = inst_obj.get("id")
                    
                    if oid in collaborations and lat is not None and lon is not None:
                        collaborations[oid]["lat"] = lat
                        collaborations[oid]["lon"] = lon
            time.sleep(0.1)
        except Exception as e:
            print(f"Error fetching institution coordinates: {e}")
            
    # Filter out institutions without coordinates and aggregate by country
    country_agg = defaultdict(lambda: {"count": 0, "institutions": [], "lat_sum": 0, "lon_sum": 0})
    for oid, data in collaborations.items():
        if data["lat"] is not None and data["lon"] is not None:
            cc = institution_cache[oid]["country_code"]
            country_agg[cc]["count"] += data["count"]
            country_agg[cc]["lat_sum"] += data["lat"] * data["count"]
            country_agg[cc]["lon_sum"] += data["lon"] * data["count"]
            country_agg[cc]["institutions"].append(data)
            
    final_output = []
    for cc, data in country_agg.items():
        # sort institutions by count desc
        data["institutions"].sort(key=lambda x: x["count"], reverse=True)
        final_output.append({
            "name": cc, # We use country code as name placeholder, or we can use a library to expand, but for now CC is fine or D3 can map it
            "country_code": cc,
            "count": data["count"],
            "lat": data["lat_sum"] / data["count"],
            "lon": data["lon_sum"] / data["count"],
            "institutions": data["institutions"]
        })
        
    print(f"Writing {len(final_output)} country aggregations to collaborations.json")
    
    with open("collaborations.json", "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2)
        
    print("Done!")

if __name__ == "__main__":
    fetch_uvic_collaborations()
