async function loadJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
    return await r.json();
}

function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") n.className = v;
        else if (k === "style" && typeof v === "object") {
            Object.assign(n.style, v);
        }
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
    }
    for (const c of children) {
        if (c == null) continue;
        if (typeof c === "string") n.appendChild(document.createTextNode(c));
        else n.appendChild(c);
    }
    return n;
}

function renderCaseDetails(container, caseStats) {
    if (!caseStats || !caseStats.kpu_12023100000000825) return;

    const caseData = caseStats.kpu_12023100000000825;

    const detailsGrid = el("div", { class: "case-details-grid" },
        el("div", { class: "case-detail-item" },
            el("strong", {}, "Номер справи"),
            el("span", {}, caseData.number)
        ),
        el("div", { class: "case-detail-item" },
            el("strong", {}, "Дата відкриття"),
            el("span", {}, caseData.date_opened)
        ),
        el("div", { class: "case-detail-item" },
            el("strong", {}, "Стаття"),
            el("span", {}, caseData.article)
        ),
        el("div", { class: "case-detail-item" },
            el("strong", {}, "Підрядник"),
            el("span", {}, caseData.contractor)
        ),
        el("div", { class: "case-detail-item" },
            el("strong", {}, "Оплачено за актами"),
            el("span", {}, caseData.paid_by_acts_uah + " грн")
        ),
        el("div", { class: "case-detail-item" },
            el("strong", {}, "Збитки (розкрадано)"),
            el("span", { style: { color: "#d32f2f", fontWeight: "bold" } }, caseData.damages_uah + " грн")
        ),
        el("div", { class: "case-detail-item", style: { gridColumn: "1 / -1" } },
            el("strong", {}, "Об'єкти"),
            el("ul", { style: { marginLeft: "1rem", marginTop: "0.5rem" } },
                ...caseData.objects.map(obj => el("li", {}, obj))
            )
        ),
        el("div", { class: "case-detail-item", style: { gridColumn: "1 / -1" } },
            el("strong", {}, "Додаткові звинувачення"),
            el("span", {}, caseData.additional_charges)
        )
    );

    container.innerHTML = "";
    container.appendChild(detailsGrid);
}

function createRankingsCharts(data) {
    const rankings = data.rankings || [];

    // QS Chart
    const qsData = rankings.find(r => r.id === 'qs_wur');
    if (qsData && qsData.points && qsData.points.length > 0) {
        const ctx = document.getElementById('qsChart');
        if (ctx) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: qsData.points.map(p => p.year),
                    datasets: [{
                        label: 'Позиція в рейтингу (середнє значення діапазону)',
                        data: qsData.points.map(p => p.value),
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        borderWidth: 3,
                        pointRadius: 5,
                        pointBackgroundColor: qsData.points.map(p => p.color || '#667eea'),
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const point = qsData.points[context.dataIndex];
                                    return `Місце: ${point.label}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            reverse: true,
                            title: {
                                display: true,
                                text: 'Позиція (нижче = гірше)',
                                font: { size: 14, weight: 'bold' }
                            },
                            ticks: {
                                callback: function (value) {
                                    const point = qsData.points.find(p => p.value === value);
                                    return point ? point.label : Math.round(value);
                                }
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Рік',
                                font: { size: 14, weight: 'bold' }
                            }
                        }
                    }
                }
            });
        }
    }

    // THE Chart
    const theData = rankings.find(r => r.id === 'the_wur');
    if (theData && theData.points && theData.points.length > 0) {
        const ctx = document.getElementById('theChart');
        if (ctx) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: theData.points.map(p => p.year),
                    datasets: [{
                        label: 'Позиція в рейтингу',
                        data: theData.points.map(p => p.value),
                        borderColor: '#FF5722',
                        backgroundColor: 'rgba(255, 87, 34, 0.1)',
                        borderWidth: 3,
                        pointRadius: 5,
                        pointBackgroundColor: theData.points.map(p => p.color || '#FF5722'),
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const point = theData.points[context.dataIndex];
                                    return `Місце: ${point.label}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            reverse: true,
                            title: {
                                display: true,
                                text: 'Позиція (нижче = гірше)',
                                font: { size: 14, weight: 'bold' }
                            },
                            ticks: {
                                callback: function (value) {
                                    const point = theData.points.find(p => p.value === value);
                                    return point ? point.label : Math.round(value);
                                }
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Рік',
                                font: { size: 14, weight: 'bold' }
                            }
                        }
                    }
                }
            });
        }
    }
}

async function main() {
    try {
        const data = await loadJSON("data.json");

        // Render case details
        const caseDetailsContainer = document.getElementById("caseDetails");
        if (caseDetailsContainer && data.case_stats) {
            renderCaseDetails(caseDetailsContainer, data.case_stats);
        }

        // Create charts
        if (window.Chart && data.rankings) {
            createRankingsCharts(data);
        }

    } catch (e) {
        console.error("Error loading data:", e);
    }
}

// Wait for Chart.js to load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
