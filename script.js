// UVic coordinates (approximate Victoria, BC, Canada)
const UVIC_COORDS = [-123.3126, 48.4634]; // Longitude, Latitude
const UVIC_OPENALEX_ID = "I212119943";

const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("#map-container")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

// Modern map projection handling
const projection = d3.geoNaturalEarth1()
    .scale(width / 5.5)
    .translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);

const g = svg.append("g");

// Tooltip helpers
const tooltip = d3.select("#tooltip");
const backBtn = d3.select("#back-btn");

let tooltipTimeout;

tooltip.on("mouseenter", () => clearTimeout(tooltipTimeout))
    .on("mouseleave", () => {
        tooltipTimeout = setTimeout(() => {
            tooltip.classed("hidden", true);
        }, 300);
    });

// Modal helpers
const modalOverlay = d3.select("#modal-overlay");
const modalClose = d3.select("#modal-close");

modalClose.on("click", () => {
    modalOverlay.classed("hidden", true);
});

// Country Name Formatter
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function getCountryName(code) {
    try {
        return regionNames.of(code) || code;
    } catch (e) {
        return code; // Fallback if invalid
    }
}

// Zoom functionality
const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => {
        g.attr("transform", event.transform);
        // Rescale nodes and strokes when zooming so they don't get massive
        g.selectAll(".node").attr("r", d => (radiusScale(d.count) / event.transform.k) + (d.is_country ? 0 : 1 / event.transform.k));
        g.selectAll(".uvic-node").attr("r", 5 / event.transform.k);
        g.selectAll(".arc").style("stroke-width", d => strokeScale(d.count) / event.transform.k);
    });

svg.call(zoom);

let globalCollaborations = [];
let radiusScale, strokeScale, opacityScale;

// Fetch Topology and generated Data
Promise.all([
    d3.json("https://unpkg.com/world-atlas@2.0.2/countries-110m.json"),
    d3.json("collaborations.json").catch(() => {
        console.warn("collaborations.json not found or not generated yet!");
        return [];
    })
]).then(([world, collaborations]) => {
    globalCollaborations = collaborations;

    // 1. Draw Countries (Map background)
    g.selectAll("path.land")
        .data(topojson.feature(world, world.objects.countries).features)
        .enter().append("path")
        .attr("class", "land")
        .attr("d", path)
        .on("click", resetZoom);

    // Map Graticules
    g.append("path")
        .datum(d3.geoGraticule())
        .attr("class", "graticule")
        .attr("d", path);

    // Draw the UVic Node (Origin)
    const uvicProj = projection(UVIC_COORDS);
    if (uvicProj) {
        g.append("circle")
            .attr("class", "uvic-node")
            .attr("cx", uvicProj[0])
            .attr("cy", uvicProj[1])
            .attr("r", 5);
    }

    drawLevel(globalCollaborations, true);

    backBtn.on("click", resetZoom);
});

// Arc Path Generator
function linkArc(d) {
    const source = projection(UVIC_COORDS);
    const target = projection([d.lon, d.lat]);
    if (!source || !target) return "";

    // Arc offset math
    const dx = target[0] - source[0];
    const dy = target[1] - source[1];
    const dr = Math.sqrt(dx * dx + dy * dy) * 1.5; // Depth of curvature

    return `M${source[0]},${source[1]}A${dr},${dr} 0 0,1 ${target[0]},${target[1]}`;
}

function drawLevel(data, isCountryLevel) {
    // Clear old elements
    g.selectAll(".arc").remove();
    g.selectAll(".node").remove();

    if (!data || data.length === 0) return;

    // Recalculate Scales based on current view data
    const maxCount = d3.max(data, d => d.count) || 1;
    opacityScale = d3.scaleLinear().domain([1, maxCount]).range([0.2, 0.85]);
    strokeScale = d3.scaleLinear().domain([1, maxCount]).range([0.5, 3]);
    radiusScale = d3.scaleSqrt().domain([1, maxCount]).range([3, 12]); // Changed to sqrt for better area scaling

    // 3. Draw Collaboration Arcs
    const arcs = g.selectAll(".arc")
        .data(data)
        .enter().append("path")
        .attr("class", "arc")
        .attr("d", linkArc)
        .style("stroke-opacity", d => opacityScale(d.count))
        // stroke width needs to factor in current zoom level, but let zoom handler do it or start at base
        .style("stroke-width", d => strokeScale(d.count) / d3.zoomTransform(svg.node()).k);

    if (isCountryLevel) {
        arcs.attr("stroke-dasharray", function () {
            const length = this.getTotalLength();
            return length + " " + length;
        })
            .attr("stroke-dashoffset", function () { return this.getTotalLength(); })
            .transition()
            .duration(2000)
            .ease(d3.easeCubicOut)
            .attr("stroke-dashoffset", 0);
    }

    // 4. Draw Collaboration Nodes
    const currentZoom = d3.zoomTransform(svg.node()).k;

    const nodes = g.selectAll(".node")
        .data(data)
        .enter().append("circle")
        .attr("class", "node")
        .attr("cx", d => (projection([d.lon, d.lat]) || [0, 0])[0])
        .attr("cy", d => (projection([d.lon, d.lat]) || [0, 0])[1])
        .attr("r", isCountryLevel ? 0 : d => radiusScale(d.count) / currentZoom)
        .style("cursor", isCountryLevel ? "pointer" : "default")
        // Tag logic to know if we are rendering countries or insts
        .each(function (d) { d.is_country = isCountryLevel; });

    if (isCountryLevel) {
        nodes.transition()
            .delay(1800)
            .duration(500)
            .attr("r", d => radiusScale(d.count) / currentZoom);
    }

    // Attach Event listeners
    nodes.on("mouseenter", function (event, d) {
        clearTimeout(tooltipTimeout);

        d3.select(this)
            .transition().duration(150)
            .attr("r", (radiusScale(d.count) + 5) / d3.zoomTransform(svg.node()).k);

        let name = isCountryLevel ? getCountryName(d.country_code) : d.name;
        d3.select("#tt-name").text(name);
        d3.select("#tt-count").text(Math.round(d.count));

        // Sub-details for top institutions
        let detailsHtml = "";
        if (isCountryLevel && d.institutions) {
            const topInsts = d.institutions.slice(0, 3);
            detailsHtml = "<strong>Top Institutions:</strong><br/>" +
                topInsts.map(i => `• ${i.name} (${i.count})`).join("<br/>");
            if (d.institutions.length > 3) {
                detailsHtml += `<br/><em>+${d.institutions.length - 3} more</em>`;
            }
            detailsHtml += `<br/><br/><button class="tooltip-action-btn" onclick="openCountryModal('${d.country_code}')">View All Institutions</button>`;
        } else if (!isCountryLevel && d.id) {
            const alexId = d.id.split('/').pop();
            const url = `https://openalex.org/works?page=1&filter=authorships.institutions.lineage:${UVIC_OPENALEX_ID},authorships.institutions.lineage:${alexId}`;
            detailsHtml += `<br/><a class="tooltip-action-btn secondary" href="${url}" target="_blank">Open in OpenAlex ↗</a>`;
        }
        d3.select("#tt-details").html(detailsHtml);

        tooltip.classed("hidden", false);
    })
        .on("mousemove", function (event) {
            tooltip.style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY + 15) + "px");
        })
        .on("mouseleave", function (event, d) {
            d3.select(this)
                .transition().duration(250)
                .attr("r", radiusScale(d.count) / d3.zoomTransform(svg.node()).k);
            tooltipTimeout = setTimeout(() => {
                tooltip.classed("hidden", true);
            }, 300);
        })
        .on("click", function (event, d) {
            if (isCountryLevel) {
                zoomToFeature(d.lon, d.lat, 4); // Zoom in
                drawLevel(d.institutions, false);
                backBtn.classed("hidden", false);
                tooltip.classed("hidden", true);
            }
        });
}

function zoomToFeature(lon, lat, scale) {
    const [x, y] = projection([lon, lat]) || [0, 0];

    svg.transition().duration(1000).call(
        zoom.transform,
        d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(scale)
            .translate(-x, -y)
    );
}

function resetZoom() {
    svg.transition().duration(1000).call(
        zoom.transform,
        d3.zoomIdentity
    );
    drawLevel(globalCollaborations, true);
    backBtn.classed("hidden", true);
}

// Resize handler
window.addEventListener('resize', () => {
    location.reload();
});

// Modal Populator Function
window.openCountryModal = function (countryCode) {
    if (!globalCollaborations) return;
    const countryData = globalCollaborations.find(c => c.country_code === countryCode);
    if (!countryData) return;

    tooltip.classed("hidden", true);

    d3.select("#modal-title").text(getCountryName(countryCode));
    d3.select("#modal-subtitle").text(`${countryData.count} total collaborations across ${countryData.institutions.length} institutions`);

    const tbody = d3.select("#modal-tbody");
    tbody.selectAll("tr").remove();

    const rows = tbody.selectAll("tr")
        .data(countryData.institutions)
        .enter()
        .append("tr");

    rows.append("td").text(d => d.name);
    rows.append("td").style("text-align", "right").text(d => Math.round(d.count));

    rows.append("td").style("text-align", "right").html(d => {
        if (!d.id) return "";
        const alexId = d.id.split('/').pop();
        const url = `https://openalex.org/works?page=1&filter=authorships.institutions.lineage:${UVIC_OPENALEX_ID},authorships.institutions.lineage:${alexId}`;
        return `<a class="row-action-btn" href="${url}" target="_blank">View ↗</a>`;
    });

    modalOverlay.classed("hidden", false);
};
