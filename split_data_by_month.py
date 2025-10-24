#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

# Read the CSV files
box_plot_df = pd.read_csv('public/box_plot_stats.csv')
org_data_df = pd.read_csv('public/org_daily_executions.csv')

# Convert dates to datetime
box_plot_df['execution_date'] = pd.to_datetime(box_plot_df['execution_date'])
org_data_df['execution_date'] = pd.to_datetime(org_data_df['execution_date'])

# Create monthly directory
monthly_dir = Path('public/monthly')
monthly_dir.mkdir(exist_ok=True)

# Get unique year-months
box_plot_months = box_plot_df['execution_date'].dt.to_period('M').unique()

print(f"Splitting data into {len(box_plot_months)} months...")

for period in sorted(box_plot_months):
    year_month = period.strftime('%Y-%m')

    # Filter data for this month
    month_box = box_plot_df[box_plot_df['execution_date'].dt.to_period('M') == period]
    month_org = org_data_df[org_data_df['execution_date'].dt.to_period('M') == period]

    # Save to CSV
    month_box.to_csv(f'public/monthly/box_plot_{year_month}.csv', index=False)
    month_org.to_csv(f'public/monthly/org_data_{year_month}.csv', index=False)

    print(f"  {year_month}: {len(month_box)} box plot days, {len(month_org)} org data points")

print("Done!")
