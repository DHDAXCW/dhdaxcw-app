#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <signal.h>
#include <time.h>
#include <getopt.h>
#include <sys/types.h>
#include <ctype.h>

#define _POSIX_C_SOURCE 200809L

/**
 * 常量定义
 */
#define MAX_LENGTH 200      // 文件路径最大长度
#define MAX_TEMP 120        // 最大温度限制（摄氏度）

/**
 * 全局变量定义
 * 存储风扇控制的各种参数，可通过命令行参数修改
 */
char thermal_file[MAX_LENGTH] = "/sys/devices/virtual/thermal/thermal_zone0/temp";      // 温度传感器文件路径 (-T)
char fan_pwm_file[MAX_LENGTH] = "/sys/class/hwmon/hwmon9/pwm1";                         // 风扇PWM控制文件路径 (-F)
char fan_speed_file[MAX_LENGTH] = "/sys/class/hwmon/hwmon9/fan1_input";                 // 风扇速度读取文件路径 (-S)

int start_speed = 35;   // 风扇启动初始速度 (-s)
int target_temp = 55;   // PID控制的目标温度 (-t)
int max_speed = 255;    // 风扇最大速度限制 (-m)
int temp_div = 1000;    // 温度系数，用于原始温度值转换 (-d)
int debug_mode = 0;     // 调试模式标志 (-D)

// 配置参数
float Kp = 5.0;         // PID比例增益系数
float Ki = 1.0;         // PID积分增益系数
float Kd = 0.01;        // PID微分增益系数
int log_interval = 10;  // 日志记录间隔（秒）
int pid_interval = 30;   // PID控制间隔（秒）

/**
 * 去除字符串两端的空白字符
 * @param str 要处理的字符串
 * @return 处理后的字符串
 */
static char* trim(char* str) {
    char* end;
    
    // 去除前导空白
    while (isspace((unsigned char)*str)) str++;
    
    if (*str == 0) return str;
    
    // 去除尾部空白
    end = str + strlen(str) - 1;
    while (end > str && isspace((unsigned char)*end)) end--;
    
    // 写入新的结束符
    end[1] = '\0';
    
    return str;
}

/**
 * 解析配置文件
 * @param config_file 配置文件路径
 * @return 成功返回0，失败返回-1
 */
static int parse_config_file(const char* config_file) {
    FILE* fp;
    char line[256];
    char* key;
    char* value;
    
    fp = fopen(config_file, "r");
    if (fp == NULL) {
        fprintf(stderr, "Warning: Cannot open config file: %s\n", config_file);
        return -1;
    }
    
    while (fgets(line, sizeof(line), fp)) {
        // 跳过注释行和空行
        if (line[0] == '#' || line[0] == '\n') continue;
        
        // 去除换行符
        line[strcspn(line, "\n")] = 0;
        
        // 查找等号
        char* equals = strchr(line, '=');
        if (equals == NULL) continue;
        
        // 分割键值对
        *equals = '\0';
        key = trim(line);
        value = trim(equals + 1);
        
        // 去除值两端的单引号
        if (value[0] == '\'') {
            value++;
            char* end_quote = strrchr(value, '\'');
            if (end_quote) *end_quote = '\0';
        }
        
        // 根据键名设置对应的配置值
        if (strcmp(key, "thermal_file") == 0) {
            snprintf(thermal_file, sizeof(thermal_file), "%s", value);
        } else if (strcmp(key, "fan_pwm_file") == 0) {
            snprintf(fan_pwm_file, sizeof(fan_pwm_file), "%s", value);
        } else if (strcmp(key, "fan_speed_file") == 0) {
            snprintf(fan_speed_file, sizeof(fan_speed_file), "%s", value);
        } else if (strcmp(key, "temp_div") == 0) {
            temp_div = atoi(value);
        } else if (strcmp(key, "start_speed") == 0) {
            start_speed = atoi(value);
        } else if (strcmp(key, "max_speed") == 0) {
            max_speed = atoi(value);
        } else if (strcmp(key, "target_temp") == 0) {
            target_temp = atoi(value);
        } else if (strcmp(key, "Kp") == 0) {
            Kp = atof(value);
        } else if (strcmp(key, "Ki") == 0) {
            Ki = atof(value);
        } else if (strcmp(key, "Kd") == 0) {
            Kd = atof(value);
        } else if (strcmp(key, "log_interval") == 0) {
            log_interval = atoi(value);
        } else if (strcmp(key, "pid_interval") == 0) {
            pid_interval = atoi(value);
        }
    }
    
    fclose(fp);
    return 0;
}

/**
 * 从指定文件读取内容
 * @param path 文件路径
 * @param result 存储读取结果的缓冲区
 * @param size 缓冲区大小，0表示自动确定
 * @return 成功返回0，失败返回-1
 */
static int read_file(const char* path ,char* result ,size_t size) {
    FILE* fp;
    char* line = NULL;
    size_t len = 0;
    ssize_t read;

    fp = fopen(path ,"r");
    if (fp == NULL)
        return -1;

    if (( read = getline(&line ,&len ,fp) ) != -1) {
        if (size != 0)
            memcpy(result ,line ,size);
        else
            memcpy(result ,line ,read - 1);
    }

    fclose(fp);
    if (line)
        free(line);
    return 0;
}

/**
 * 向指定文件写入内容
 * @param path 文件路径
 * @param buf 要写入的数据缓冲区
 * @param len 数据长度
 * @return 成功写入的字节数，失败返回0
 */
static size_t write_file(const char* path ,char* buf ,size_t len) {
    FILE* fp = NULL;
    size_t size = 0;
    fp = fopen(path ,"w+");
    if (fp == NULL) {
        return 0;
    }
    size = fwrite(buf ,len ,1 ,fp);
    fclose(fp);
    return size;
}

/**
 * 读取当前温度值
 * @param thermal_file 温度传感器文件路径
 * @param div 温度系数，用于将原始值转换为摄氏度
 * @return 温度值（摄氏度），读取失败返回-1
 */
float get_temperature(char* thermal_file ,int div) {
    char buf[8] = { 0 };
    if (read_file(thermal_file ,buf ,0) == 0) {
        return (float)atoi(buf) / div;
    }
    return -1.0;
}

/**
 * 设置风扇转速
 * @param fan_speed_set 风扇速度值（0-255）
 * @param fan_pwm_file 风扇PWM控制文件路径
 * @return 成功写入的字节数，失败返回0
 */
int set_fanspeed(int fan_speed_set, char* fan_pwm_file) {
    char buf[8] = { 0 };
    sprintf(buf, "%d\n", fan_speed_set);
    return write_file(fan_pwm_file, buf, strlen(buf));
}

/**
 * 读取当前风扇速度
 * @param fan_speed_file 风扇速度读取文件路径
 * @return 风扇速度（RPM），读取失败返回-1
 */
int get_fanspeed(char* fan_speed_file) {
    char buf[8] = { 0 };
    if (read_file(fan_speed_file, buf, 0) == 0) {
        return atoi(buf);
    }
    return -1;
}

/**
 * 计算风扇转速
 */
// PID 控制器参数
typedef struct {
    float Kp;
    float Ki;
    float Kd;
    float integral;
    float prev_error;
} PIDController;

// 初始化 PID 控制器
void PID_Init(PIDController *pid, float Kp, float Ki, float Kd) {
    pid->Kp = Kp;
    pid->Ki = Ki;
    pid->Kd = Kd;
    pid->integral = 0;
    pid->prev_error = 0;
}

// PID 计算
float PID_Calculate(PIDController *pid, float setpoint, float actual_value, float dt) {
    // 误差计算：实际温度 - 目标温度
    // 当实际温度高于目标温度时，误差为正，需要增加风扇速度
    float error = actual_value - setpoint;
    
    // 积分项计算，但限制积分项的范围防止过度累积
    pid->integral += error * dt;
    // 限制积分项在合理范围内，防止过度累积
    if (pid->integral > 100.0) pid->integral = 100.0;
    if (pid->integral < 0.0) pid->integral = 0.0;
    
    float derivative = (error - pid->prev_error) / dt;
    pid->prev_error = error;
    
    return pid->Kp * error + pid->Ki * pid->integral + pid->Kd * derivative;
}

// 计算风扇转速
int calculate_speed_set(float current_temp, int max_temp, int target_temp, int max_speed, int min_speed) {
    // 使用 PID 控制器计算风扇转速
    static PIDController pid;
    static int initialized = 0;
    if (!initialized) {
        PID_Init(&pid, Kp, Ki, Kd); // 使用配置的 PID 参数
        initialized = 1;
    }

    // 使用配置的目标温度作为 PID 控制的目标值
    float setpoint = (float)target_temp;
    float output = PID_Calculate(&pid, setpoint, current_temp, 1.0); // 计算 PID 输出

    // 当当前温度低于目标温度时，PID输出应该逐渐减小到0
    // 当PID输出为0时，风扇应该完全停止
    float pid_output;
    if (output < 0) {
        pid_output = 0.0; // 最低输出为0，风扇停止
    } else if (output > 100.0) {
        pid_output = 100.0; // 最高输出
    } else {
        pid_output = output; // 直接使用输出值
    }

    // 计算百分比 (0-1.0)
    float percentage = pid_output / 100.0;

    // 根据百分比计算风扇速度
    // 当percentage为0时，风扇速度为0（停止）
    // 当percentage大于0时，风扇速度从min_speed开始
    float fan_speed_float;
    if (percentage <= 0.0) {
        fan_speed_float = 0.0; // PID输出为0时风扇停止
    } else {
        fan_speed_float = min_speed + (percentage * (max_speed - min_speed));
    }
    
    int fan_speed_set = (int)(fan_speed_float + 0.5); // 四舍五入

    // 限制风扇速度在有效范围内
    if (fan_speed_set > max_speed) {
        fan_speed_set = max_speed;
    } else if (fan_speed_set < 0) {
        fan_speed_set = 0; // 确保不会出现负值
    }
    
    return fan_speed_set;
}

// 记录温度日志
void log_temperature(float current_temp) {
    // 确保 /tmp/log/ 目录存在
    mkdir("/tmp/log", 0755);

    // 读取现有日志内容
    FILE *log_file = fopen("/tmp/log/log.fancontrol_temp", "r");
    char **lines = NULL;
    size_t line_count = 0;
    char line[256];
    
    if (log_file) {
        // 读取所有现有行
        while (fgets(line, sizeof(line), log_file) != NULL) {
            lines = realloc(lines, (line_count + 1) * sizeof(char*));
            lines[line_count] = strdup(line);
            line_count++;
        }
        fclose(log_file);
    }

    // 生成新的日志行（最新的在最前面）
    time_t now;
    time(&now);
    char time_str[20];
    strftime(time_str, sizeof(time_str), "%Y-%m-%d %H:%M:%S", localtime(&now));
    char new_line[256];
    snprintf(new_line, sizeof(new_line), "[%s] %.1f\n", time_str, current_temp);

    // 根据温度记录间隔计算1小时最多记录的条目数
    // 1小时 = 3600秒，除以记录间隔得到最大条目数
    const size_t max_lines = (log_interval > 0) ? (3600 / log_interval) : 360;
    
    // 重新打开文件写入（最新的在最前面）
    log_file = fopen("/tmp/log/log.fancontrol_temp", "w");
    if (log_file) {
        // 先写入新记录（最新的在最前面）
        fputs(new_line, log_file);
        
        // 然后写入现有记录，但不超过最大限制
        size_t lines_to_write = (line_count < max_lines - 1) ? line_count : max_lines - 1;
        for (size_t i = 0; i < lines_to_write; i++) {
            fputs(lines[i], log_file);
            free(lines[i]);
        }
        
        // 释放剩余的内存
        for (size_t i = lines_to_write; i < line_count; i++) {
            free(lines[i]);
        }
        
        if (lines) free(lines);
        fclose(log_file);
    } else {
        // 如果写入失败，释放内存
        for (size_t i = 0; i < line_count; i++) {
            free(lines[i]);
        }
        if (lines) free(lines);
    }
}

/**
 * 判断文件是否存在方法
 */
static int file_exist(const char* name) {
    struct stat buffer;
    return stat(name ,&buffer);
}

/**
 *  信号处理函数
 */
void handle_termination(int signum) {
    // 设置风扇转速为 0
    set_fanspeed(0 ,fan_pwm_file);
    exit(EXIT_SUCCESS); // 优雅地退出程序
}

/**
 * 注册信号处理函数
 */
void register_signal_handlers( ) {
    signal(SIGINT, handle_termination);
    signal(SIGTERM, handle_termination);
}

/**
 * 主函数
 */
int main(int argc, char* argv[]) {
    // 解析命令行选项
    int opt;
    while ((opt = getopt(argc, argv, "T:F:S:s:t:m:d:D:v:")) != -1) {
        switch (opt) {
            case 'T':
                snprintf(thermal_file, sizeof(thermal_file), "%s", optarg);
                break;
            case 'F':
                snprintf(fan_pwm_file, sizeof(fan_pwm_file), "%s", optarg);
                break;
            case 'S':
                snprintf(fan_speed_file, sizeof(fan_speed_file), "%s", optarg);
                break;
            case 's':
                start_speed = atoi(optarg);
                break;
            case 't':
                target_temp = atoi(optarg);
                break;
            case 'm':
                max_speed = atoi(optarg);
                break;
            case 'd':
                temp_div = atoi(optarg);
                break;
            case 'D':
                debug_mode = atoi(optarg);
                break;
            default:
                fprintf(stderr, "Usage: %s [option]\n"
                    "          -T sysfs         # temperature sysfs file, default is '%s'\n"
                    "          -F sysfs         # fan PWM sysfs file, default is '%s'\n"
                    "          -S sysfs         # fan speed sysfs file, default is '%s'\n"
                    "          -s speed         # initial speed for fan startup, default is %d\n"
                    "          -t temperature   # target temperature for PID control, default is %d°C\n"
                    "          -m speed         # fan maximum speed, default is %d\n"
                    "          -d div           # temperature divide, default is %d\n"
                    "          -v               # verbose\n", argv[0], thermal_file, fan_pwm_file, fan_speed_file, start_speed, target_temp, max_speed, temp_div);
                exit(EXIT_FAILURE);
        }
    }

    // 检测虚拟文件是否存在
    if (file_exist(fan_pwm_file) != 0 || file_exist(thermal_file) != 0) {
        fprintf(stderr, "File: '%s' or '%s' not exist\n", fan_pwm_file, thermal_file);
        exit(EXIT_FAILURE);
    }

    // 注册退出信号
    register_signal_handlers();

    // 解析配置文件
    parse_config_file("/etc/config/fancontrol");

    // 初始化日志文件（清空旧日志）
    mkdir("/tmp/log", 0755);
    FILE *log_file = fopen("/tmp/log/log.fancontrol_temp", "w");
    if (log_file) fclose(log_file);

    // 主循环
    time_t last_log_time = 0;
    time_t last_pid_time = 0;
    int fan_speed_set = start_speed;  // 初始风扇速度
    
    while (1) {
        // 读取当前温度
        float temperature = get_temperature(thermal_file, temp_div);

        // 记录温度日志（按配置间隔）
        time_t now;
        time(&now);
        if (difftime(now, last_log_time) >= log_interval) {
            log_temperature(temperature);
            last_log_time = now;
        }

        // PID计算（按配置间隔）
        if (difftime(now, last_pid_time) >= pid_interval) {
            fan_speed_set = calculate_speed_set(temperature, MAX_TEMP, target_temp, max_speed, start_speed);
            set_fanspeed(fan_speed_set, fan_pwm_file);
            last_pid_time = now;
        }

        // 休眠1秒，然后继续检查
        sleep(1);
    }

    return 0;
}
