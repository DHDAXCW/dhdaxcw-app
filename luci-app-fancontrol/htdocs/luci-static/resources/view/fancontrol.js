'use strict';
'require view';
'require fs';
'require form';
'require uci';

/**
 * 默认文件路径占位符
 * 当配置文件中没有设置相应参数时使用这些默认值
 */
const THERMAL_FILE_PLACEHOLDER = '/sys/devices/virtual/thermal/thermal_zone0/temp';         // 默认温度传感器文件路径
const FAN_PWM_FILE_PLACEHOLDER = '/sys/class/hwmon/hwmon7/pwm1';                            // 默认风扇PWM控制文件路径
const FAN_SPEED_FILE_PLACEHOLDER = '/sys/class/hwmon/hwmon7/fan1_input';                    // 默认风扇速度读取文件路径

/**
 * 读取文件内容的异步函数
 * @param {string} filePath - 要读取的文件路径
 * @returns {Promise<number|null>} 解析为文件内容数值，读取失败时返回null
 */
async function readFile(filePath) {
    try {
        const rawData = await fs.read(filePath);
        if (rawData) {
            return parseInt(rawData.trim());
        }
        return null;
    } catch (err) {
        return null; // 返回null表示读取失败
    }
}

/**
 * 读取温度日志文件
 * @returns {Promise<Array>} 解析为温度数据数组，读取失败返回空数组
 */
async function readTemperatureLog() {
    try {
        const logData = await fs.read('/tmp/log/log.fancontrol_temp');
        if (!logData) {
            console.log("No log data found");
            return [];
        }
        
        const lines = logData.trim().split('\n');
        const data = [];
        
        console.log("Processing log lines:", lines.length);
        
        for (const line of lines) {
            if (!line.trim()) continue; // 跳过空行
            
            // 解析格式: [2025-10-04 07:46:07] 54.9
            // 更宽松的正则表达式，允许空格变化
            const match = line.match(/\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]\s+(\d+\.?\d*)/);
            if (match) {
                const [, datetime, temperature] = match;
                const timestamp = new Date(datetime).getTime();
                
                // 验证时间戳是否有效
                if (!isNaN(timestamp)) {
                    data.push({
                        time: datetime.split(' ')[1], // HH:MM:SS
                        temperature: parseFloat(temperature),
                        timestamp: timestamp
                    });
                } else {
                    console.warn("Invalid timestamp in log line:", line);
                }
            } else {
                console.warn("Failed to parse log line:", line);
            }
        }
        
        console.log("Successfully parsed data points:", data.length);
        return data;
    } catch (err) {
        console.error("Error reading temperature log:", err);
        return [];
    }
}

/**
 * 获取CSS变量值
 * @param {string} variable - CSS变量名
 * @param {string} defaultValue - 默认值
 * @returns {string} CSS变量值
 */
function getCSSVariable(variable, defaultValue) {
    const computedStyle = getComputedStyle(document.documentElement);
    return computedStyle.getPropertyValue(variable).trim() || defaultValue;
}

/**
 * 创建温度趋势图表
 * @param {HTMLElement} container - 图表容器
 * @param {Array} data - 温度数据
 * @param {number} targetTemp - 目标温度
 */
function createTemperatureChart(container, data, targetTemp) {
    const canvas = container.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    
    // 获取主题颜色
    const primaryColor = getCSSVariable('--primary', '#0066cc');
    const borderColor = getCSSVariable('--border-color', '#ccc');
    const gridColor = getCSSVariable('--grid-color', '#f0f0f0');
    const textColor = getCSSVariable('--text-color', '#666');
    
    // 清除画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (data.length === 0) {
        // 没有数据时显示提示
        ctx.fillStyle = textColor;
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(_('No temperature data available'), canvas.width / 2, canvas.height / 2);
        return;
    }
    
    const padding = { top: 20, right: 30, bottom: 40, left: 50 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;
    
    // 计算温度范围
    const temperatures = data.map(d => d.temperature);
    const minTemp = Math.min(...temperatures, targetTemp) - 2;
    const maxTemp = Math.max(...temperatures, targetTemp) + 2;
    
    // 时间范围（最近1小时）
    const now = Date.now();
    const timeRange = 60 * 60 * 1000; // 1小时
    const minTime = now - timeRange;
    
    // 过滤最近1小时的数据
    const recentData = data.filter(d => d.timestamp >= minTime);
    
    if (recentData.length === 0) {
        // 没有最近1小时的数据时显示提示
        ctx.fillStyle = textColor;
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(_('No temperature data in the last hour'), canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // 绘制网格线和坐标轴 - 使用统一的颜色和线宽
    ctx.strokeStyle = borderColor;
    ctx.setLineDash([]);
    ctx.lineWidth = 0.5;
    
    // Y轴网格 - 每个温度值一条横线
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
        const y = padding.top + (chartHeight / ySteps) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
        
        // Y轴刻度
        const temp = maxTemp - ((maxTemp - minTemp) / ySteps) * i;
        ctx.fillStyle = textColor;
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(temp.toFixed(1) + '°C', padding.left - 5, y + 4);
    }
    
    // X轴网格 - 每个时间点一条竖线
    const xTimeSteps = 10;
    for (let i = 0; i <= xTimeSteps; i++) {
        const x = padding.left + (chartWidth / xTimeSteps) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartHeight);
        ctx.stroke();
    }
    
    // 绘制坐标轴 - 使用与网格线相同的颜色和线宽
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.5;
    
    // Y轴
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.stroke();
    
    // X轴
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    
    // 绘制目标温度虚线
    ctx.strokeStyle = primaryColor;
    ctx.setLineDash([5, 3]);
    ctx.lineWidth = 1;
    
    const targetY = padding.top + chartHeight - ((targetTemp - minTemp) / (maxTemp - minTemp)) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, targetY);
    ctx.lineTo(padding.left + chartWidth, targetY);
    ctx.stroke();
    
    // 在右侧显示目标温度值
    ctx.fillStyle = primaryColor;
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(targetTemp + '°C', padding.left + chartWidth + 5, targetY + 4);
    
    // 绘制温度趋势线（平滑曲线）
    ctx.strokeStyle = primaryColor;
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < recentData.length; i++) {
        const point = recentData[i];
        const x = padding.left + ((point.timestamp - minTime) / timeRange) * chartWidth;
        const y = padding.top + chartHeight - ((point.temperature - minTemp) / (maxTemp - minTemp)) * chartHeight;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            // 使用二次贝塞尔曲线实现平滑
            const prevPoint = recentData[i - 1];
            const prevX = padding.left + ((prevPoint.timestamp - minTime) / timeRange) * chartWidth;
            const prevY = padding.top + chartHeight - ((prevPoint.temperature - minTemp) / (maxTemp - minTemp)) * chartHeight;
            
            const cpX = (prevX + x) / 2;
            ctx.quadraticCurveTo(cpX, prevY, x, y);
        }
    }
    
    ctx.stroke();
    
    // 移除数据点圆点，只保留平滑曲线
    
    // 绘制X轴时间刻度
    ctx.fillStyle = textColor;
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    
    for (let i = 0; i <= xTimeSteps; i++) {
        const x = padding.left + (chartWidth / xTimeSteps) * i;
        const time = new Date(minTime + (timeRange / xTimeSteps) * i);
        const timeStr = time.toLocaleTimeString('zh-CN', { hour12: false }).substring(0, 8);
        
        ctx.fillText(timeStr, x, padding.top + chartHeight + 20);
    }
    
    // 返回数据用于悬停交互
    return {
        recentData,
        minTime,
        timeRange,
        minTemp,
        maxTemp,
        padding,
        chartWidth,
        chartHeight
    };
}

/**
 * 显示悬停提示
 * @param {number} x - 鼠标X坐标
 * @param {number} y - 鼠标Y坐标
 * @param {string} content - 提示内容
 */
function showTooltip(x, y, content) {
    let tooltip = document.getElementById('chart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'chart-tooltip';
        tooltip.style.position = 'absolute';
        tooltip.style.padding = '4px 8px';
        tooltip.style.background = '#333';
        tooltip.style.color = '#fff';
        tooltip.style.borderRadius = '4px';
        tooltip.style.fontSize = '12px';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.zIndex = '1000';
        tooltip.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = content;
    tooltip.style.left = `${x + 10}px`;
    tooltip.style.top = `${y + 10}px`;
    tooltip.style.display = 'block';
}

/**
 * 隐藏悬停提示
 */
function hideTooltip() {
    const tooltip = document.getElementById('chart-tooltip');
    if (tooltip) tooltip.style.display = 'none';
}

/**
 * LuCI风扇控制应用主视图
 * 提供风扇控制的Web界面，包括温度监控、PWM控制和速度反馈
 */
return view.extend({
    /**
     * 加载配置数据
     * @returns {Promise} 配置加载完成的Promise
     */
    load: function() {
        return Promise.all([uci.load('fancontrol')]);
    },
    
    /**
     * 渲染配置界面
     * @param {Object} data - 配置数据
     * @returns {Promise} 渲染完成的Promise
     */
    render: async function(data) {
        // 创建配置表单映射
        const m = new form.Map('fancontrol', _('Fan General Control'));
        
        // 创建配置区域
        const s = m.section(form.TypedSection, 'settings', _('Settings'));
        s.anonymous = true; // 不显示section标题

        // ==================== 基本控制选项 ====================
        
        // 启用/禁用风扇控制
        let o = s.option(form.Flag, 'enable', _('Enable'), _('Enable fan control'));
        o.rmempty = false; // 不允许空值

        // ==================== 文件路径配置选项 ====================
        
        // 温度传感器文件路径配置
        o = s.option(form.Value, 'thermal_file', _('Thermal File'), _('Path to the temperature sensor file'));
        o.placeholder = THERMAL_FILE_PLACEHOLDER; // 默认占位符文本

        // 读取并显示当前温度
        const thermalFile = uci.get('fancontrol', '@settings[0]', 'thermal_file') || THERMAL_FILE_PLACEHOLDER;
        const tempDiv = parseInt(uci.get('fancontrol', '@settings[0]', 'temp_div')) || 1000;
        const temp = await readFile(thermalFile);
        if (temp !== null && tempDiv > 0) {
            // 成功读取温度：显示当前温度值
            o.description = _('Current temperature:') + ` <b>${(temp / tempDiv).toFixed(1)}°C</b>`;
        } else {
            // 读取失败：显示错误信息
            o.description = _('Error reading temperature or invalid temp_div');
        }

        // 风扇PWM控制文件路径配置
        o = s.option(form.Value, 'fan_pwm_file', _('Fan PWM File'), _('Path to the fan PWM control file'));
        o.placeholder = FAN_PWM_FILE_PLACEHOLDER;

        // 读取并显示当前PWM值
        const pwmFile = uci.get('fancontrol', '@settings[0]', 'fan_pwm_file') || FAN_PWM_FILE_PLACEHOLDER;
        const pwmValue = await readFile(pwmFile);
        if (pwmValue !== null) {
            // 成功读取PWM：显示百分比和原始值
            o.description = _('Current PWM:') + ` <b>${(pwmValue / 255 * 100).toFixed(1)}%</b> (${pwmValue})`;
        } else {
            // 读取失败：显示错误信息
            o.description = _('Error reading fan PWM file');
        }

        // 风扇速度读取文件路径配置
        o = s.option(form.Value, 'fan_speed_file', _('Fan Speed File'), _('Path to the fan speed reading file (e.g., /sys/class/hwmon/hwmon7/fan1_input)'));
        o.placeholder = FAN_SPEED_FILE_PLACEHOLDER;

        // 读取并显示当前风扇速度
        const speedFile = uci.get('fancontrol', '@settings[0]', 'fan_speed_file') || FAN_SPEED_FILE_PLACEHOLDER;
        const speed = await readFile(speedFile);
        if (speed !== null) {
            // 成功读取速度：显示RPM值
    	    o.description = _('Current speed:') + ` <b>${speed} RPM</b>`;
	    } else {
            // 读取失败：显示错误信息
    	    o.description = _('Error reading fan speed file');
	    }
 
        // ==================== 风扇控制参数选项 ====================
        
        // 温度系数配置（用于温度值转换）
		o = s.option(form.Value, 'temp_div', _('Temperature coefficient'), _('The temperature coefficient defaults to 1000. Used to convert raw temperature reading to Celsius.'));
        o.placeholder = '1000';
		
        // 风扇启动初始速度
		o = s.option(form.Value, 'start_speed', _('Initial Speed'), _('Please enter the initial speed for fan startup (0-255).'));
        o.placeholder = '35';

        // 风扇最大速度限制
        o = s.option(form.Value, 'max_speed', _('Max Speed'), _('Please enter maximum fan speed (0-255).'));
        o.placeholder = '255';

        // 目标温度设置（PID控制的目标温度）
        o = s.option(form.Value, 'target_temp', _('Target Temperature'), _('Please enter the target temperature for PID control in Celsius.'));
        o.placeholder = '55';

        // ==================== PID控制参数选项 ====================
        
        // PID比例增益系数
        o = s.option(form.Value, 'Kp', _('PID Kp'), _('Proportional gain for PID control. Higher values make the system respond faster but may cause overshoot.'));
        o.placeholder = '5.0';

        // PID积分增益系数
        o = s.option(form.Value, 'Ki', _('PID Ki'), _('Integral gain for PID control. Helps eliminate steady-state error but may cause oscillation.'));
        o.placeholder = '1.0';

        // PID微分增益系数
        o = s.option(form.Value, 'Kd', _('PID Kd'), _('Derivative gain for PID control. Dampens the system response and reduces overshoot.'));
        o.placeholder = '0.01';

        // ==================== 系统参数选项 ====================
        
        // 温度记录间隔
        o = s.option(form.Value, 'log_interval', _('Log Interval'), _('Temperature logging interval in seconds (default: 10).'));
        o.placeholder = '10';

        // PID计算周期
        o = s.option(form.Value, 'pid_interval', _('PID Interval'), _('PID calculation interval in seconds (default: 5).'));
        o.placeholder = '30';

        // 渲染表单
        const renderedForm = await m.render();
        
        // ==================== 温度趋势图区域 ====================
        // 创建图表容器元素并插入到页面顶部
        const chartContainer = E('div', {
            'class': 'temperature-chart-container',
            'style': 'margin-bottom: 20px; padding: 10px; background: transparent;'
        });
        
        // 创建Trend标题
        const trendTitle = E('div', {
            'class': 'cbi-section',
            'style': 'margin-bottom: 10px;'
        }, [
            E('h3', {}, _('Trend'))
        ]);
        
            // 图表标题 - 使用与参数文字相同的颜色
            const title = E('div', {
                'style': 'font-weight: bold; margin-bottom: 10px; text-align: center; color: var(--text-color, #666);'
            }, _('Temperature Trend (Last 1 Hour)'));
        
        // Canvas图表 - 自适应宽度
        const canvas = E('canvas', {
            'width': '800',
            'height': '300',
            'style': 'width: 100%; max-width: 100%; height: 300px; display: block; margin: 0 auto;'
        });
        
        chartContainer.appendChild(trendTitle);
        chartContainer.appendChild(title);
        chartContainer.appendChild(canvas);
        
        // 插入到Fan General Control标题下方，Settings section上方
        const settingsSection = renderedForm.querySelector('.cbi-section');
        if (settingsSection) {
            renderedForm.insertBefore(chartContainer, settingsSection);
        } else {
            // 如果没有找到Settings section，插入到第一个子元素之前
            renderedForm.insertBefore(chartContainer, renderedForm.firstChild);
        }
        
        // 动态调整canvas分辨率以适应容器宽度
        let chartData = null;
        const resizeCanvas = () => {
            const containerWidth = chartContainer.offsetWidth - 20; // 减去padding
            if (containerWidth > 0) {
                canvas.width = containerWidth;
                canvas.height = 300;
                
                // 重新绘制图表
                const targetTemp = parseInt(uci.get('fancontrol', '@settings[0]', 'target_temp')) || 55;
                readTemperatureLog().then(data => {
                    chartData = createTemperatureChart(chartContainer, data, targetTemp);
                });
            }
        };
        
        // 初始调整和窗口大小变化时重新调整
        setTimeout(resizeCanvas, 0); // 使用setTimeout确保DOM已渲染
        window.addEventListener('resize', resizeCanvas);
        
        // 获取目标温度
        const targetTemp = parseInt(uci.get('fancontrol', '@settings[0]', 'target_temp')) || 55;
        
        // 初始绘制图表
        readTemperatureLog().then(data => {
            console.log("Temperature data loaded:", data.length, "points");
            chartData = createTemperatureChart(chartContainer, data, targetTemp);
            
            // 添加鼠标悬停交互功能
            canvas.addEventListener('mousemove', (e) => {
                if (!chartData || !chartData.recentData || chartData.recentData.length === 0) return;
                
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const hoverRadius = 6;
                let found = false;

                for (const point of chartData.recentData) {
                    const x = chartData.padding.left + ((point.timestamp - chartData.minTime) / chartData.timeRange) * chartData.chartWidth;
                    const y = chartData.padding.top + chartData.chartHeight - ((point.temperature - chartData.minTemp) / (chartData.maxTemp - chartData.minTemp)) * chartData.chartHeight;

                    if (Math.abs(mouseX - x) < hoverRadius && Math.abs(mouseY - y) < hoverRadius) {
                        showTooltip(e.pageX, e.pageY, `${point.time}<br>${point.temperature.toFixed(1)}°C`);
                        found = true;
                        break;
                    }
                }

                if (!found) hideTooltip();
            });

            canvas.addEventListener('mouseleave', hideTooltip);
        }).catch(err => {
            console.error("Error loading temperature data:", err);
            // 显示错误信息
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = getCSSVariable('--text-color', '#666');
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(_('Error loading temperature data'), canvas.width / 2, canvas.height / 2);
        });
        
        // 自动刷新机制
        const logInterval = parseInt(uci.get('fancontrol', '@settings[0]', 'log_interval')) || 10;
        const refreshInterval = Math.max(logInterval * 1000, 5000); // 最小5秒刷新间隔
        
        let refreshTimer = setInterval(() => {
            readTemperatureLog().then(data => {
                console.log("Temperature data loaded:", data.length, "points");
                createTemperatureChart(chartContainer, data, targetTemp);
            });
        }, refreshInterval);
        
        // 清理定时器（当页面卸载时）
        window.addEventListener('beforeunload', () => {
            if (refreshTimer) {
                clearInterval(refreshTimer);
            }
        });
        
        return renderedForm;
    }
});
