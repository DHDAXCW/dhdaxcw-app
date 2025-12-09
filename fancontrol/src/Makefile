# Simple Makefile for fancontrol program
# Uses OpenWrt cross-compilation variables

PROGRAM=fancontrol
SOURCES=fancontrol.c

# Default target
all: $(PROGRAM)

# Compile the program
$(PROGRAM): $(SOURCES)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $(PROGRAM) $(SOURCES)

# Clean target
clean:
	rm -f $(PROGRAM) *.o *~

.PHONY: all clean
