#
# Fan Control Daemon Makefile
# 这个包负责安装fancontrol二进制程序和系统配置文件
#

include $(TOPDIR)/rules.mk

# 包信息
PKG_NAME:=fancontrol
PKG_VERSION:=3.0
PKG_RELEASE:=5

# 包元数据
PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Alec

include $(INCLUDE_DIR)/package.mk

# 包定义
define Package/fancontrol
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=FanControl for OpenWRT
  DEPENDS:=+kmod-hwmon-pwmfan
endef

define Package/fancontrol/description
  FanControl for OpenWRT.
endef

# 编译规则
define Build/Prepare
	# 创建构建目录
	mkdir -p $(PKG_BUILD_DIR)
	# 复制源代码和Makefile到构建目录
	$(CP) ./src/* $(PKG_BUILD_DIR)/
	$(CP) ./src/Makefile $(PKG_BUILD_DIR)/
endef

define Build/Compile
	# 编译fancontrol程序
	$(MAKE) -C $(PKG_BUILD_DIR) CC="$(TARGET_CC)" CFLAGS="$(TARGET_CFLAGS) -Wall -Wextra" LDFLAGS="$(TARGET_LDFLAGS)"
endef

# 安装规则
define Package/fancontrol/install
	# 安装二进制文件到系统路径
	# 路径: /usr/bin/fancontrol
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/fancontrol $(1)/usr/bin/fancontrol
	
	# 安装UCI配置文件
	# 路径: /etc/config/fancontrol
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/fancontrol.config $(1)/etc/config/fancontrol
	
	# 安装init脚本
	# 路径: /etc/init.d/fancontrol
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/fancontrol.init $(1)/etc/init.d/fancontrol
endef

# 安装后启用服务
define Package/fancontrol/postinst
#!/bin/sh
# 检查是否在系统启动时运行
if [ -z "$${IPKG_INSTROOT}" ]; then
	# 启用服务
	/etc/init.d/fancontrol enable
	# 启动服务（如果enable=1）
	uci get fancontrol.@settings[0].enable >/dev/null 2>&1 && \
	[ "$$(uci get fancontrol.@settings[0].enable)" = "1" ] && \
	/etc/init.d/fancontrol start
fi
exit 0
endef

# 构建包
$(eval $(call BuildPackage,fancontrol))
