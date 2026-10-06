import ReactApexChart from "react-apexcharts";

const ChartBarRunning = ({ variant = 1, currency = 'AED' }) => {
  // Different data variants for tabs
  const dataVariants = {
    1: [
      { name: 'Revenue', data: [55, 35, 80, 40, 80, 55, 95, 40, 45, 80, 55, 75] },
      { name: 'Expenses', data: [20, 80, 40, 70, 20, 80, 40, 15, 60, 30, 80, 35] }
    ],
    2: [
      { name: 'Revenue', data: [45, 55, 60, 80, 45, 75, 65, 50, 65, 60, 75, 85] },
      { name: 'Expenses', data: [30, 40, 35, 50, 35, 45, 30, 25, 40, 45, 50, 40] }
    ],
    3: [
      { name: 'Revenue', data: [65, 45, 90, 50, 70, 65, 85, 50, 55, 90, 65, 85] },
      { name: 'Expenses', data: [25, 70, 50, 60, 25, 70, 50, 20, 50, 35, 70, 45] }
    ],
    4: [
      { name: 'Revenue', data: [75, 55, 100, 60, 90, 75, 105, 60, 65, 100, 75, 95] },
      { name: 'Expenses', data: [30, 90, 60, 80, 30, 90, 60, 25, 70, 45, 90, 55] }
    ]
  };

  const series = dataVariants[variant] || dataVariants[1];

  const options = {
    chart: {
      type: "bar",
      height: 280,
      stacked: true,
      toolbar: { show: false },
      fontFamily: "Inter, sans-serif",
      foreColor: "#adb0bb",
      dropShadow: {
        enabled: true,
        top: 8,
        blur: 5,
        color: "#E91E63",
        opacity: 0.15
      }
    },
    colors: ["#E91E63", "#FCE4EC"],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "30%",
        borderRadius: 4,
        borderRadiusApplication: "end",
        borderRadiusWhenStacked: "last"
      }
    },
    dataLabels: { enabled: false },
    legend: { show: false },
    grid: {
      show: true,
      borderColor: "#E4E4E4",
      strokeDashArray: 3,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } }
    },
    xaxis: {
      categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: { fontSize: "12px", colors: "#adb0bb", fontWeight: 400 }
      }
    },
    yaxis: {
      tickAmount: 4,
      min: 0,
      max: 150,
      labels: {
        style: { fontSize: "12px", colors: "#adb0bb", fontWeight: 400 },
        formatter: function (val) {
          return val + "K";
        }
      }
    },
    tooltip: {
      theme: "dark",
      y: {
        formatter: function (val) {
          return currency + " " + val + "K";
        }
      }
    }
  };

  return (
    <ReactApexChart
      options={options}
      series={series}
      type="bar"
      height={280}
    />
  );
};

export default ChartBarRunning;
