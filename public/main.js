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
    if(rows.length == 0) return;
    
    if(temperature < low) low = temperature;

    rows.forEach(row => {
        if(row.temperature < low) low = row.temperature;
    });
    lowDisplay.innerHTML = low + "°C";
}

function update() {
    tempDisplay.innerHTML = temperature + "°C";
    setLow();
}

function generateLabels(mode) {
    if(mode == "day") return generateDayLabels();
}

function generateDayLabels() {
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

function generateData(mode) {
    const temperatures = [];
    let date = new Date();
    date.setHours(date.getHours() - 23, 0, 0 , 0);

    let i = 0;
    while(i < data.length && temperatures.length < 24) {
        const row = data[i];

        const dataDate = new Date(row.timestamp);
        console.log(dataDate.toLocaleString());
        console.log(date.toLocaleString());
        
        if(row.timestamp == date.getTime()) {
            temperatures.push(row.temperature);
            i++;
        }
        else {
            temperatures.push(null);
        }

        date.setHours(date.getHours() + 1);
    }

    console.log(temperatures);
    return temperatures;
}

// Chart for past data
const ctx = document.getElementById('myLineChart').getContext('2d');
const container = document.getElementById('data-container');

let data = [];

rows.forEach(row => {
    data.push({timestamp: row.timestamp * 1000, temperature: row.temperature});
});

if(data.length == 0) {
    document.getElementById('myLineChart').style.display = "none";
    document.getElementById("no_data").style.display = "block";
}
else {
    const myLineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: generateLabels("day"),
            datasets: [{
                    data: generateData("day"),
                    borderColor: '#379c88',
                    backgroundColor: 'rgba(59, 239, 179, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
            responsive: true,
            
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
                    beginAtZero: true
                }
            }
        }
    });
}

const TEMPERATURE_URL = "http://localhost:3000/current";

setInterval(() => {
    console.log("Fetching temperature...");
    getTemperature(TEMPERATURE_URL);

    // Set interval for refreshing last 24 hours
}, 30000);



