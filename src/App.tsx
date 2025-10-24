import { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import './App.css';

interface BoxPlotStats {
  execution_date: string;
  total_executions: number;
  avg_executions_per_org: number;
  median_executions: number;
  percentile_25: number;
  percentile_75: number;
  percentile_5: number;
  percentile_95: number;
  org_count: number;
  moving_avg_7day: number;
}

interface OrgDailyData {
  execution_date: string;
  org_id: string;
  workflow_execution_count: number;
}

// Available months (Feb 2024 - July 2025)
const AVAILABLE_MONTHS = [
  '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
  '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07'
];

function App() {
  const [currentMonthIndex, setCurrentMonthIndex] = useState(AVAILABLE_MONTHS.length - 1); // Start at latest month
  const [boxPlotData, setBoxPlotData] = useState<BoxPlotStats[]>([]);
  const [orgData, setOrgData] = useState<OrgDailyData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chartRef = useRef<SVGSVGElement>(null);

  const currentMonth = AVAILABLE_MONTHS[currentMonthIndex];
  const [year, month] = currentMonth.split('-');

  // Load data for current month
  useEffect(() => {
    setLoading(true);
    setError(null);

    Promise.all([
      d3.csv(`/monthly/box_plot_${currentMonth}.csv`),
      d3.csv(`/monthly/org_data_${currentMonth}.csv`)
    ])
      .then(([boxStats, orgStats]) => {
        const parsedBoxData: BoxPlotStats[] = boxStats.map((d: any) => ({
          execution_date: d.execution_date,
          total_executions: +d.total_executions,
          avg_executions_per_org: +d.avg_executions_per_org,
          median_executions: +d.median_executions,
          percentile_25: +d.percentile_25,
          percentile_75: +d.percentile_75,
          percentile_5: +d.percentile_5,
          percentile_95: +d.percentile_95,
          org_count: +d.org_count,
          moving_avg_7day: +d.moving_avg_7day,
        }));

        const parsedOrgData: OrgDailyData[] = orgStats.map((d: any) => ({
          execution_date: d.execution_date,
          org_id: d.org_id,
          workflow_execution_count: +d.workflow_execution_count,
        }));

        setBoxPlotData(parsedBoxData);
        setOrgData(parsedOrgData);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading CSV:', err);
        setError(`Failed to load data for ${currentMonth}`);
        setLoading(false);
      });
  }, [currentMonth]);

  // Render visualization with streaming animation
  useEffect(() => {
    if (boxPlotData.length === 0 || !chartRef.current) return;

    // Clear previous chart
    d3.select(chartRef.current).selectAll('*').remove();

    renderTimeSeriesChart();
  }, [boxPlotData, orgData]);

  const renderTimeSeriesChart = useCallback(() => {
    if (!chartRef.current) return;

    const margin = { top: 80, right: 250, bottom: 100, left: 120 };
    const containerWidth = chartRef.current.parentElement?.clientWidth || window.innerWidth - 64;
    const width = Math.max(containerWidth - margin.left - margin.right - 48, 1200);
    const height = 600 - margin.top - margin.bottom;

    const svg = d3.select(chartRef.current)
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Parse dates
    const parseDate = d3.timeParse('%Y-%m-%d');
    boxPlotData.forEach(d => (d.execution_date as any) = parseDate(d.execution_date));
    orgData.forEach(d => (d.execution_date as any) = parseDate(d.execution_date));

    // Scales - reduce spacing between days by cutting padding in half
    const dateExtent = d3.extent(boxPlotData, d => d.execution_date as any) as [Date, Date];
    const timeRange = dateExtent[1].getTime() - dateExtent[0].getTime();
    const paddingReduction = timeRange * 0.025; // Half the default padding

    const xScale = d3.scaleTime()
      .domain([new Date(dateExtent[0].getTime() - paddingReduction), new Date(dateExtent[1].getTime() + paddingReduction)])
      .range([0, width]);

    // Left Y axis: Individual org execution counts (from jitter points and box plot stats)
    const minExec = Math.min(
      d3.min(boxPlotData, d => d.percentile_5) || 0,
      d3.min(orgData, d => d.workflow_execution_count) || 0
    );
    const maxExec = Math.max(
      d3.max(boxPlotData, d => d.percentile_95) || 0,
      d3.max(orgData, d => d.workflow_execution_count) || 0
    );

    // Add 15% padding on both ends for better spread
    const yPadding = (maxExec - minExec) * 0.15;

    const yScale = d3.scaleLinear()
      .domain([Math.max(0, minExec - yPadding), maxExec + yPadding])
      .range([height, 0]);

    // Right Y axis: 7-day moving average (already calculated correctly, no division by org_count)
    const minMovingAvg = d3.min(boxPlotData, d => d.moving_avg_7day) || 0;
    const maxMovingAvg = d3.max(boxPlotData, d => d.moving_avg_7day) || 0;
    const movingAvgPadding = (maxMovingAvg - minMovingAvg) * 0.15;

    const yScaleMovingAvg = d3.scaleLinear()
      .domain([Math.max(0, minMovingAvg - movingAvgPadding), maxMovingAvg + movingAvgPadding])
      .range([height, 0]);

    // Color scale for orgs - use Rewst brand colors
    const uniqueOrgs = Array.from(new Set(orgData.map(d => d.org_id)));
    const rewstColors = ['#009490', '#2BB5B6', '#C64A9A', '#F9A100', '#F75B58', '#504384', '#6a5445', '#00C4C0', '#FF6B9D', '#FFB74D'];
    const colorScale = d3.scaleOrdinal()
      .domain(uniqueOrgs)
      .range(rewstColors);

    // X Axis - Rewst style
    const xAxis = svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale).ticks(10))
      .style('font-size', '13px')
      .style('color', '#90A4AE');

    xAxis.selectAll('text')
      .style('fill', '#CFD8DC')
      .attr('transform', 'rotate(-35)')
      .style('text-anchor', 'end')
      .style('font-weight', '500');

    xAxis.selectAll('line, path')
      .style('stroke', '#504384');

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height + 75)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('fill', '#2BB5B6')
      .style('font-weight', '600')
      .text('Date');

    // Left Y Axis - Rewst style
    const leftAxis = svg.append('g')
      .call(d3.axisLeft(yScale).ticks(10))
      .style('font-size', '13px');

    leftAxis.selectAll('text')
      .style('fill', '#CFD8DC')
      .style('font-weight', '500');

    leftAxis.selectAll('line, path')
      .style('stroke', '#504384');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2)
      .attr('y', -85)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('fill', '#2BB5B6')
      .style('font-weight', '600')
      .text('Workflow Executions per Organization');

    // Right Y Axis for Moving Average - Rewst style
    const rightAxis = svg.append('g')
      .attr('transform', `translate(${width},0)`)
      .call(d3.axisRight(yScaleMovingAvg).ticks(10))
      .style('font-size', '13px');

    rightAxis.selectAll('text')
      .style('fill', '#CFD8DC')
      .style('font-weight', '500');

    rightAxis.selectAll('line, path')
      .style('stroke', '#504384');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2)
      .attr('y', width + 85)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('fill', '#F9A100')
      .style('font-weight', '600')
      .text('7-Day Moving Average');

    // Grid lines - Rewst style
    svg.append('g')
      .attr('class', 'grid')
      .attr('opacity', 0.1)
      .call(d3.axisLeft(yScale).tickSize(-width).tickFormat(() => ''))
      .selectAll('line')
      .style('stroke', '#009490');

    // Define gradient for boxes - Rewst colors
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'boxGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#009490')  // Rewst Primary Teal
      .attr('stop-opacity', 0.8);

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#2BB5B6')  // Rewst Light Teal
      .attr('stop-opacity', 0.5);

    // Layer 1: Box plots with faster streaming animation
    const boxWidth = Math.max(width / boxPlotData.length * 0.95, 3);  // Use 95% of available space per day

    boxPlotData.forEach((d, i) => {
      const x = xScale(d.execution_date as any);
      const delay = i * 12; // Faster stagger - was 30ms, now 12ms

      // Whiskers (5th to 95th percentile) - Rewst Gray
      const whisker = svg.append('line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', height)
        .attr('y2', height)
        .attr('stroke', '#90A4AE')  // Rewst Gray
        .attr('stroke-width', 2)
        .attr('opacity', 0);

      whisker.transition()
        .delay(delay)
        .duration(250)  // Faster - was 400ms
        .attr('y1', yScale(d.percentile_5))
        .attr('y2', yScale(d.percentile_95))
        .attr('opacity', 0.9);  // More prominent

      // Box (25th to 75th percentile) with Rewst gradient - animate simultaneously with whisker
      const box = svg.append('rect')
        .attr('x', x - boxWidth / 2)
        .attr('y', height)
        .attr('width', boxWidth)
        .attr('height', 0)
        .attr('fill', 'url(#boxGradient)')
        .attr('opacity', 0)
        .attr('stroke', '#009490')  // Rewst Primary Teal
        .attr('stroke-width', 2.5)  // Thicker stroke for prominence
        .attr('rx', 2);

      box.transition()
        .delay(delay + 50)  // Start almost immediately after whisker
        .duration(300)  // Faster - was 500ms
        .attr('y', yScale(d.percentile_75))
        .attr('height', yScale(d.percentile_25) - yScale(d.percentile_75))
        .attr('opacity', 0.85);  // More prominent

      // Median line - Rewst Fandango - animate with box
      const medianLine = svg.append('line')
        .attr('x1', x - boxWidth / 2)
        .attr('x2', x + boxWidth / 2)
        .attr('y1', height)
        .attr('y2', height)
        .attr('stroke', '#C64A9A')  // Rewst Fandango
        .attr('stroke-width', 3)
        .attr('opacity', 0);

      medianLine.transition()
        .delay(delay + 100)  // Overlap with box animation
        .duration(200)  // Faster - was 300ms
        .attr('y1', yScale(d.median_executions))
        .attr('y2', yScale(d.median_executions))
        .attr('opacity', 1);
    });

    // Layer 2: Jitter plot with streaming animation - start early, overlap with box plots
    const jitterWidth = boxWidth * 0.98;  // Use 98% of box width for jitter spread

    const dots = svg.selectAll('.org-dot')
      .data(orgData)
      .enter()
      .append('circle')
      .attr('class', 'org-dot')
      .attr('cx', d => {
        const baseX = xScale((d.execution_date as any));
        const jitter = (Math.random() - 0.5) * jitterWidth;
        return baseX + jitter;
      })
      .attr('cy', height)
      .attr('r', 0)
      .attr('fill', d => colorScale(d.org_id) as string)
      .attr('opacity', 0);

    // Stream in dots much faster - start after just a few box plots, overlap heavily
    dots.transition()
      .delay((d, i) => 100 + i * 0.8)  // Start at 100ms, very fast stagger
      .duration(300)  // Faster - was 500ms
      .attr('cy', d => yScale(d.workflow_execution_count))
      .attr('r', 2.5)
      .attr('opacity', 0.35);  // Lower opacity for better visual hierarchy

    // Layer 3: 7-day moving average with path animation - use RIGHT Y axis scale
    // NOTE: moving_avg_7day is already the average per org, no need to divide again
    const line = d3.line<BoxPlotStats>()
      .x(d => xScale(d.execution_date as any))
      .y(d => yScaleMovingAvg(d.moving_avg_7day));

    const path = svg.append('path')
      .datum(boxPlotData)
      .attr('fill', 'none')
      .attr('stroke', '#F9A100')  // Rewst Orange
      .attr('stroke-width', 5)  // Thicker for better visual hierarchy
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('d', line)
      .attr('opacity', 0)
      .attr('filter', 'drop-shadow(0 0 12px rgba(249, 161, 0, 0.8))');

    const totalLength = (path.node() as any).getTotalLength();

    // Start moving average much sooner - overlap with other animations
    path
      .attr('stroke-dasharray', totalLength + ' ' + totalLength)
      .attr('stroke-dashoffset', totalLength)
      .transition()
      .delay(200)  // Start very early - was boxPlotData.length * 30 + orgData.length * 2
      .duration(1200)  // Faster - was 2000ms
      .ease(d3.easeQuadInOut)
      .attr('stroke-dashoffset', 0)
      .attr('opacity', 1);

    // Title with Rewst gradient
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -45)
      .attr('text-anchor', 'middle')
      .style('font-size', '28px')
      .style('font-weight', 'bold')
      .style('fill', 'url(#titleGradient)')
      .style('letter-spacing', '1px')
      .text(`${new Date(year + '-' + month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);

    // Title gradient - Rewst colors
    const titleGradient = defs.append('linearGradient')
      .attr('id', 'titleGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%');

    titleGradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#009490');  // Rewst Primary Teal

    titleGradient.append('stop')
      .attr('offset', '50%')
      .attr('stop-color', '#C64A9A');  // Rewst Fandango

    titleGradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#F9A100');  // Rewst Orange

    // Enhanced Legend - Rewst style
    const legend = svg.append('g')
      .attr('transform', `translate(${width + 30}, 0)`);

    const legendItems = [
      { label: '7-Day Avg (Right Axis)', color: '#F9A100', type: 'line', width: 5 },
      { label: 'IQR Box (25-75%)', color: '#009490', type: 'rect' },
      { label: 'Median Line', color: '#C64A9A', type: 'line', width: 3 },
      { label: 'Whiskers (5-95%)', color: '#90A4AE', type: 'line', width: 2 },
      { label: 'Organization Data', color: '#2BB5B6', type: 'circle' }
    ];

    legendItems.forEach((item, i) => {
      const g = legend.append('g')
        .attr('transform', `translate(0, ${i * 38})`);

      if (item.type === 'rect') {
        g.append('rect')
          .attr('width', 26)
          .attr('height', 18)
          .attr('fill', 'url(#boxGradient)')
          .attr('opacity', 0.7)
          .attr('stroke', item.color)
          .attr('stroke-width', 2)
          .attr('rx', 2);
      } else if (item.type === 'circle') {
        g.append('circle')
          .attr('cx', 13)
          .attr('cy', 9)
          .attr('r', 5)
          .attr('fill', item.color)
          .attr('opacity', 0.6);
      } else {
        g.append('line')
          .attr('x1', 0)
          .attr('x2', 26)
          .attr('y1', 9)
          .attr('y2', 9)
          .attr('stroke', item.color)
          .attr('stroke-width', item.width || 3);
      }

      g.append('text')
        .attr('x', 35)
        .attr('y', 13)
        .style('font-size', '14px')
        .style('fill', '#ECEFF1')  // Rewst Light
        .style('font-weight', '500')
        .text(item.label);
    });
  }, [boxPlotData, orgData, year, month]);

  const goToPreviousMonth = () => {
    if (currentMonthIndex > 0) {
      setCurrentMonthIndex(currentMonthIndex - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonthIndex < AVAILABLE_MONTHS.length - 1) {
      setCurrentMonthIndex(currentMonthIndex + 1);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl text-transparent bg-clip-text bg-gradient-to-r from-[#009490] via-[#C64A9A] to-[#F9A100] font-bold mb-4 animate-pulse">
            Loading {new Date(year + '-' + month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}...
          </div>
          <div className="w-16 h-16 border-4 border-[#009490] border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-2xl text-[#F75B58]">{error}</div>
      </div>
    );
  }

  const monthDate = new Date(year + '-' + month);
  const monthName = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-8">
      <div className="w-full">
        {/* Header - Rewst branded */}
        <div className="mb-8 text-center">
          <h1 className="text-6xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-[#009490] via-[#C64A9A] to-[#F9A100] drop-shadow-2xl">
            Automation Time Series
          </h1>
          <p className="text-[#CFD8DC] text-xl font-medium">
            Daily Workflow Execution Patterns • Box Plot with Jitter Overlay
          </p>
        </div>

        {/* Stats Cards - Rewst colors */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
          <div className="bg-gradient-to-br from-[#009490]/20 to-[#009490]/5 backdrop-blur-xl rounded-2xl p-6 border-2 border-[#009490]/40 shadow-2xl hover:scale-105 transition-transform">
            <div className="text-[#2BB5B6] text-sm font-bold mb-2 uppercase tracking-wide">Days in Month</div>
            <div className="text-5xl font-bold text-white">{boxPlotData.length}</div>
            <div className="text-[#90A4AE] text-sm mt-2">Data points</div>
          </div>
          <div className="bg-gradient-to-br from-[#F9A100]/20 to-[#F9A100]/5 backdrop-blur-xl rounded-2xl p-6 border-2 border-[#F9A100]/40 shadow-2xl hover:scale-105 transition-transform">
            <div className="text-[#F9A100] text-sm font-bold mb-2 uppercase tracking-wide">Avg Daily Executions</div>
            <div className="text-5xl font-bold text-white">
              {d3.mean(boxPlotData, d => d.total_executions)?.toFixed(0).toLocaleString()}
            </div>
            <div className="text-[#90A4AE] text-sm mt-2">Across all orgs</div>
          </div>
          <div className="bg-gradient-to-br from-[#C64A9A]/20 to-[#C64A9A]/5 backdrop-blur-xl rounded-2xl p-6 border-2 border-[#C64A9A]/40 shadow-2xl hover:scale-105 transition-transform">
            <div className="text-[#C64A9A] text-sm font-bold mb-2 uppercase tracking-wide">Avg Orgs/Day</div>
            <div className="text-5xl font-bold text-white">
              {d3.mean(boxPlotData, d => d.org_count)?.toFixed(0).toLocaleString()}
            </div>
            <div className="text-[#90A4AE] text-sm mt-2">Active organizations</div>
          </div>
          <div className="bg-gradient-to-br from-[#F75B58]/20 to-[#F75B58]/5 backdrop-blur-xl rounded-2xl p-6 border-2 border-[#F75B58]/40 shadow-2xl hover:scale-105 transition-transform">
            <div className="text-[#F75B58] text-sm font-bold mb-2 uppercase tracking-wide">Data Points</div>
            <div className="text-5xl font-bold text-white">{orgData.length.toLocaleString()}</div>
            <div className="text-[#90A4AE] text-sm mt-2">Org-day combinations</div>
          </div>
        </div>

        {/* Chart Container - Rewst style */}
        <div className="bg-slate-900/50 backdrop-blur-xl rounded-3xl p-8 border-2 border-[#009490]/30 shadow-2xl">
          <svg ref={chartRef}></svg>
        </div>

        {/* Navigation Controls - Rewst branded */}
        <div className="flex justify-center items-center gap-8 mt-8">
          <button
            onClick={goToPreviousMonth}
            disabled={currentMonthIndex === 0}
            className={`group flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg transition-all shadow-xl ${
              currentMonthIndex === 0
                ? 'bg-[#333333]/30 text-[#90A4AE] cursor-not-allowed border-2 border-[#333333]/50'
                : 'bg-gradient-to-r from-[#009490] to-[#2BB5B6] text-white hover:from-[#2BB5B6] hover:to-[#009490] hover:scale-110 hover:shadow-[#009490]/60 border-2 border-[#009490]'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
            </svg>
            Previous
          </button>

          <div className="text-center">
            <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#009490] via-[#C64A9A] to-[#F9A100]">
              {monthName}
            </div>
            <div className="text-sm text-[#90A4AE] mt-1 font-medium">
              {currentMonthIndex + 1} of {AVAILABLE_MONTHS.length}
            </div>
          </div>

          <button
            onClick={goToNextMonth}
            disabled={currentMonthIndex === AVAILABLE_MONTHS.length - 1}
            className={`group flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg transition-all shadow-xl ${
              currentMonthIndex === AVAILABLE_MONTHS.length - 1
                ? 'bg-[#333333]/30 text-[#90A4AE] cursor-not-allowed border-2 border-[#333333]/50'
                : 'bg-gradient-to-r from-[#C64A9A] to-[#F9A100] text-white hover:from-[#F9A100] hover:to-[#C64A9A] hover:scale-110 hover:shadow-[#C64A9A]/60 border-2 border-[#C64A9A]'
            }`}
          >
            Next
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Footer Info - Rewst style */}
        <div className="mt-10 text-center text-[#90A4AE] text-sm space-y-2">
          <p className="text-lg">
            Showing <span className="text-[#009490] font-bold">{orgData.length.toLocaleString()}</span> data points •
            Stratified sampling with all statistical outliers included
          </p>
          <p className="text-xs text-[#CFD8DC]">
            <span className="text-[#009490] font-semibold">Box plot:</span> IQR (25th-75th percentile) •
            <span className="text-[#90A4AE] font-semibold"> Whiskers:</span> 5th-95th percentile •
            <span className="text-[#F9A100] font-semibold"> Orange line:</span> 7-day moving average (right axis)
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
