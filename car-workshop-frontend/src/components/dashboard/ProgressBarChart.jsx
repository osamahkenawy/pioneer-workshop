import ReactApexChart from "react-apexcharts";

const ProgressBarChart = ({ value = 75, color = '#E91E63' }) => {
  const series = [value];
  const options = {
    chart: {
      type: 'radialBar',
      offsetY: 0,
      height: 160,
      sparkline: {
        enabled: true
      }
    },
    plotOptions: {
      radialBar: {
        startAngle: -180,
        endAngle: 180,
        track: {
          background: "#FCE4EC",
          strokeWidth: '100%',
          margin: 3,
        },
        hollow: {
          margin: 20,
          size: '60%',
          background: 'transparent',
          image: undefined,
          imageOffsetX: 0,
          imageOffsetY: 0,
          position: 'front',
        },
        dataLabels: {
          name: {
            show: false
          },
          value: {
            offsetY: 5,
            fontSize: '24px',
            color: '#000000',
            fontWeight: 600,
          }
        }
      }
    },
    responsive: [{
      breakpoint: 1600,
      options: {
        chart: {
          height: 150
        },
      }
    }],
    grid: {
      padding: {
        top: -10
      }
    },
    fill: {
      type: 'gradient',
      colors: color,
      gradient: {
        shade: '#F9F9FB',
        type: 'horizontal',
        shadeIntensity: 0.1,
        gradientToColors: ['#F48FB1'],
        inverseColors: true,
        opacityFrom: 1,
        opacityTo: 1,
        stops: [0, 120]
      },
    },
    labels: ['Progress'],
  };

  return (
    <ReactApexChart
      options={options}
      series={series}
      type="radialBar"
      height={160}
    />
  );
};

export default ProgressBarChart;
