let tempDisplay = document.getElementById("current");
let lowDisplay = document.getElementById("low");

let temperature;

async function getTemperature(url) {
    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        temperature = Number(data.temperature);
        console.log("Received reading: " + temperature);
        update();

        return data;

    } catch (error) {
        console.error('Fetch failed:', error);
    }
}

function setLow() {    
    if(low == null || low == undefined || low == "null") low = temperature;
    if(temperature < low) low = temperature;

    if(hourlyRows.length == 0) return;

    hourlyRows.forEach(row => {
        if(row.temperature < low) low = row.temperature;
    });
    lowDisplay.innerHTML = low + "°C";
}

function update() {
    tempDisplay.innerHTML = temperature + "°C";
    setLow();
}

function generateDailyLabels(days) {
    console.log(days);
    labels = [];
    const date = new Date();
    date.setDate(date.getDate() - days + 1);

    for(var i = 0; i < days; i++) {
        const formattedDate = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric' 
        });
        labels.push(formattedDate);
        date.setDate(date.getDate() + 1);
    }

    return labels;
}

function generateHourlyLabels() {
    labels = [];
    let date = new Date();
    date.setHours(date.getHours() - 23, 0, 0, 0);

    for(let i = 0; i < 24 + 3; i++) {
        const hour12 = date.toLocaleString('en-US', { hour: 'numeric', hour12: true });
        labels.push(hour12);
        date.setHours(date.getHours() + 1);
    }

    return labels;
}

function generateHourlyData(data) {
    const temperatures = [];
    let date = new Date();
    date.setHours(date.getHours() - 23, 0, 0 , 0);

    let i = 0;
    while(i < hourlyData.length && temperatures.length < 24) {
        const row = data[i];
        
        if(row.timestamp == date.getTime()) {
            temperatures.push(row.temperature);
            i++;
        }
        else {
            temperatures.push(null);
        }

        date.setHours(date.getHours() + 1);
    }

    return temperatures;
}

function generateDailyData() {
    const lows = [];
    const highs = [];
    const avgs = [];

    const date = new Date();
    date.setDate(date.getDate() - 29);
    date.setHours(0, 0, 0, 0);

    let i = 0;

    let noData = true;

    for (let day = 0; day < 30; day++) {
        const timestamp = Math.floor(date.getTime() / 1000);

        if (i < dailyData.length && Number(dailyData[i].timestamp) === timestamp) {
            noData = false;
            lows.push(dailyData[i].min_temperature);
            highs.push(dailyData[i].max_temperature);
            avgs.push(dailyData[i].avg_temperature);
            i++;
        } else {
            if(!noData) {
                lows.push(null);
                highs.push(null);
                avgs.push(null);
            }
        }

        date.setDate(date.getDate() + 1);
    }

    while(lows.length < 7) {
        lows.unshift(null);
        highs.unshift(null);
        avgs.unshift(null);
    }

    return [lows, highs, avgs];
}

// Chart for hourly data
const ctxHourly = document.getElementById('hourlyChart').getContext('2d');
let hourlyData = [];

hourlyRows.forEach(row => {
    hourlyData.push({timestamp: row.timestamp * 1000, temperature: row.temperature});
});

if(hourlyData.length == 0) {
    document.getElementById('hourlyChart').style.display = "none";
    document.getElementById("no_data").style.display = "block";
}
else {
    const hourlyChart = new Chart(ctxHourly, {
        type: 'line',
        data: {
            labels: generateHourlyLabels(),
            datasets: [{
                    data: generateHourlyData(hourlyData),
                    borderColor: '#379c88',
                    backgroundColor: 'rgba(59, 239, 179, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
            responsive: true,
            maintainAspectRatio: false,
            
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: {
                        autoSkip: true,
                        maxRotation: 0,
                        minRotation: 0
                    }
                },
                y: {
                    beginAtZero: true,
                    suggestedMax: Math.max(...generateHourlyData(hourlyData).filter(v => v !== null)) + 5
                }
            }
        }
    });
}

const ctxDaily = document.getElementById('dailyChart').getContext('2d');
let dailyData = [];

dailyRows.forEach(row => {
    dailyData.push(row);
});

if(dailyData.length == 0) {
    document.getElementById('hourlyChart').style.display = "none";
    document.getElementById("no_data").style.display = "block";
}
else {
    const dailyTableData = generateDailyData();
    const dailyChart = new Chart(ctxDaily, {
        type: 'line',
        data: {
            labels: generateDailyLabels(dailyTableData[0].length),
            datasets: [
                {
                    label: 'High',
                    data: dailyTableData[1],
                    borderColor: '#de7474',
                    borderWidth: 2,
                    fill: {
                        target: 1,
                        above: 'rgba(151, 229, 181, 0.27)'
                    },
                    tension: 0.3
                },
                {
                    label: 'Low',
                    data: dailyTableData[0],
                    borderColor: '#7be8d2',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.3
                }
            ]
            },
            options: {
            responsive: true,
            maintainAspectRatio: false,
            
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                }
            },
            scales: {
                x: {
                    ticks: {
                        autoSkip: true,
                        maxRotation: 0,
                        minRotation: 0
                    }
                },
                y: {
                    suggestedMax: Math.max(...dailyTableData[1].filter(v => v !== null)) + 5,
                    suggestedMin: Math.min(...dailyTableData[1].filter(v => v !== null)) - 5
                }
            }
        }
    });
}

const TEMPERATURE_URL = (debug != null && debug) ? 
    "http://temperaturemonitor.onrender.com/current" : 
    "https://temperaturemonitor.onrender.com/current";

setInterval(() => {
    getTemperature(TEMPERATURE_URL);

    // Set interval for refreshing last 24 hours
}, 5000);



